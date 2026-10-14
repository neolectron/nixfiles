import { Console, Context, Effect, Layer, Option, Ref, Schema, Semaphore } from 'effect';
import { Audio, type Application, type Change, type Master } from '../audio.ts';
import * as Bindings from '../bindings.ts';
import { StreamDeck } from '../stream-deck.ts';
import { StreamDeckError } from '../errors.ts';
import type { Control, DialRotate, Position, Size } from '../model.ts';
import * as Display from '../mixer-renderer.ts';
import { volumeColor } from '../volume-gauge.ts';
import * as Plugin from '../plugin.ts';
import { MixerCards } from '../mixer-cards.ts';

export interface MixerOptions { readonly step?: number; readonly refreshMillis?: number; readonly flushMillis?: number; readonly renderer?: Display.RendererKind }
export interface MixerState {
  readonly apps: ReadonlyArray<Application>;
  readonly assignments: ReadonlyArray<string | null>;
  readonly page: number;
  readonly online: boolean;
  readonly master: Master | undefined;
  readonly masterOnline: boolean;
}
/** Surviving apps keep their order, compact left, and newly discovered apps append. */
export const assign = (previous: ReadonlyArray<string | null>, apps: ReadonlyArray<Application>, trailing: ReadonlySet<string> = new Set()): ReadonlyArray<string> => {
  const keys = new Set(apps.map((app) => app.key));
  const slots = previous.filter((key): key is string => key !== null && keys.has(key));
  for (const app of apps) if (!slots.includes(app.key)) slots.push(app.key);
  return [...slots.filter((key) => !trailing.has(key)), ...slots.filter((key) => trailing.has(key))];
};
export interface Slot extends Position, Size { readonly dial: number }
/** Derive horizontal knob alignment from device geometry, with a uniform fallback. */
export const slotsFor = (dials: ReadonlyArray<Control>, lcd: Control): ReadonlyArray<Slot> => {
  const width = lcd.pixelSize!.width;
  const sorted = [...dials].sort((a, b) => (a.bounds?.x ?? a.index) - (b.bounds?.x ?? b.index));
  const centers = sorted.map((dial, i) => dial.bounds && lcd.bounds
    ? Math.max(0, Math.min(width, dial.bounds.x + dial.bounds.width / 2 - lcd.bounds.x)) : (i + 0.5) * width / sorted.length);
  return sorted.map((dial, i) => {
    const left = i === 0 ? 0 : Math.round((centers[i - 1]! + centers[i]!) / 2);
    const right = i === sorted.length - 1 ? width : Math.round((centers[i]! + centers[i + 1]!) / 2);
    return { dial: dial.index, x: left, y: 0, width: right - left, height: lcd.pixelSize!.height };
  });
};
/** App I/O remains a separate service; this script owns knob bindings and feedback. */
export const make = (options: MixerOptions = {}) => Effect.gen(function*() {
  const deck = yield* StreamDeck;
  const audio = yield* Audio;
  const extensions = Option.getOrUndefined(yield* Effect.serviceOption(MixerCards));
  const step = options.step ?? 2;
  const pollMillis = options.refreshMillis ?? 500;
  const flushMillis = options.flushMillis ?? 40;
  if (![step, pollMillis, flushMillis].every((value) => Number.isFinite(value) && value > 0)) return yield* Effect.fail(new StreamDeckError({ reason: 'InvalidArgument', operation: 'mixer', message: 'Mixer timing and step must be positive.' }));
  const lcd = deck.lcds[0];
  if (!lcd?.pixelSize || deck.dials.length < 2) return yield* Effect.fail(new StreamDeckError({ reason: 'Unsupported', operation: 'mixer', message: 'The audio mixer needs at least two dials and an LCD strip.' }));
  const display = yield* Display.make(options.renderer ?? 'svg');
  const slots = slotsFor(deck.dials, lcd);
  const appSlots = slots.slice(0, -1);
  const masterSlot = slots.at(-1)!;
  const state = yield* Ref.make<MixerState>({ apps: [], assignments: [], page: 0, online: true, master: undefined, masterOnline: true });
  const pending = yield* Ref.make<ReadonlyMap<string, Change>>(new Map());
  const pendingMaster = yield* Ref.make<{ readonly target: Master; readonly change: Change } | undefined>(undefined);
  const screen = yield* Semaphore.make(1);
  const cache = new Map<number, string>();
  const regions = yield* Ref.make<ReadonlyArray<Slot>>(slots);
  const render = (next: MixerState) => Effect.gen(function*() {
    let changed = false;
    let coveredUntil = 0;
    const drawn: Slot[] = [];
    for (const [i, slot] of slots.entries()) {
      if (slot.x < coveredUntil) { cache.delete(i); continue; }
      const isMaster = slot.dial === masterSlot.dial;
      const app = isMaster ? next.master : next.apps.find((app) => app.key === next.assignments[next.page * appSlots.length + i]);
      const online = isMaster ? next.masterOnline : next.online;
      let available = slot;
      if (!isMaster && app) for (let j = i + 1; j < appSlots.length && !next.assignments[next.page * appSlots.length + j]; j++) {
        available = { ...slot, width: appSlots[j]!.x + appSlots[j]!.width - slot.x };
      }
      const custom = !isMaster && app && 'key' in app && extensions ? yield* extensions.frame(app, slot, available) : undefined;
      const region = { ...slot, width: custom?.size.width ?? slot.width };
      drawn.push(region); coveredUntil = region.x + region.width;
      const stamp = JSON.stringify([region, online, app?.name, app && Math.round(app.volume), app?.muted, app && 'mixedMute' in app && app.mixedMute, app && volumeColor(app.volume), custom?.stamp]);
      if (cache.get(i) === stamp) continue;
      const image = custom ? yield* custom.draw : undefined;
      yield* deck.lcd(lcd.index).drawRegion(region, image ?? (yield* display.card(region, app, online, isMaster ? 'MASTER' : undefined)));
      cache.set(i, stamp);
      changed = true;
    }
    yield* Ref.set(regions, drawn);
    yield* Ref.set(state, next); // Routing changes only after matching feedback is written.
    if (changed) yield* Console.log(JSON.stringify({ kind: 'mixer-view', page: next.page + 1, online: next.online,
      slots: slots.map((slot, i) => {
        const isMaster = slot.dial === masterSlot.dial;
        const app = isMaster ? next.master : next.apps.find((app) => app.key === next.assignments[next.page * appSlots.length + i]);
        return { dial: slot.dial, app: isMaster ? 'MASTER' : app?.name ?? null, volume: app && Math.round(app.volume), muted: app?.muted };
      }),
    }));
  });
  const refresh = Semaphore.withPermits(screen, 1)(Effect.gen(function*() {
    const before = yield* Ref.get(state);
    let apps = yield* audio.list.pipe(Effect.catch((error) => Effect.gen(function*() {
      if (before.online) yield* Effect.logWarning('Audio unavailable', error.message);
      return undefined;
    })));
    if (apps && extensions) {
      const retained = yield* extensions.retain;
      for (const identity of retained) if (!apps.some((app) => app.key === identity.key || identity.aliases?.includes(app.key))) {
        const previous = before.apps.find((app) => app.key === identity.key || identity.aliases?.includes(app.key));
        apps = [...apps, { key: previous?.key ?? identity.key, name: identity.name, streams: [], volume: previous?.volume ?? 0, muted: previous?.muted ?? false, mixedMute: false, paused: true }];
      }
    }
    const master = yield* audio.master.pipe(Effect.map((value) => ({ value, online: true })), Effect.catch((error) => Effect.gen(function*() {
      if (before.masterOnline) yield* Effect.logWarning('Master unavailable', error.message);
      return { value: undefined, online: false };
    })));
    const trailing = new Set<string>();
    if (apps && extensions) for (const app of apps) if ((yield* extensions.placement(app)) === 'last') trailing.add(app.key);
    const assignments = apps ? assign(before.assignments, apps, trailing) : before.assignments;
    const page = Math.min(before.page, Math.max(0, Math.ceil(assignments.length / appSlots.length) - 1));
    yield* render({ apps: apps ?? [], assignments, page, online: !!apps, master: master.value, masterOnline: master.online });
  }));
  const enqueue = (dial: number, delta: number, toggles: number) => Semaphore.withPermits(screen, 1)(Effect.gen(function*() {
    const view = yield* Ref.get(state);
    if (dial === masterSlot.dial) {
      const target = view.master; if (!view.masterOnline || !target) return;
      yield* Ref.update(pendingMaster, (previous) => {
        const change = previous?.target.name === target.name && previous.target.serial === target.serial ? previous.change : { delta: 0, toggles: 0 };
        return { target, change: { delta: change.delta + delta, toggles: change.toggles + toggles } };
      });
      return;
    }
    if (!view.online) return;
    const slot = appSlots.findIndex((slot) => slot.dial === dial);
    const key = slot < 0 ? undefined : view.assignments[view.page * appSlots.length + slot];
    if (!key) return;
    yield* Ref.update(pending, (changes) => {
      const next = new Map(changes); const previous = next.get(key) ?? { delta: 0, toggles: 0 };
      next.set(key, { delta: previous.delta + delta, toggles: previous.toggles + toggles }); return next;
    });
    const app = view.apps.find((app) => app.key === key);
    if (app && extensions && (delta || toggles) && (yield* extensions.adjust(app, { delta, toggles }))) yield* render(view);
  }));
  const flush = Effect.gen(function*() {
    const changes = yield* Ref.getAndSet(pending, new Map());
    const master = yield* Ref.getAndSet(pendingMaster, undefined);
    for (const [key, change] of changes) {
      if (!change.delta && !(change.toggles % 2)) continue;
      yield* audio.change(key, change).pipe(Effect.catch((error) => Effect.logWarning('Audio control failed', key, error.message)));
      yield* Console.log(JSON.stringify({ kind: 'audio-request', app: key, ...change }));
    }
    if (master && (master.change.delta || master.change.toggles % 2)) {
      yield* audio.changeMaster(master.target, master.change).pipe(Effect.catch((error) => Effect.logWarning('Master control failed', error.message)));
      yield* Console.log(JSON.stringify({ kind: 'master-request', output: master.target.name, ...master.change }));
    }
    if (changes.size || master) yield* refresh;
  });
  const changePage = (direction: number) => Semaphore.withPermits(screen, 1)(Effect.gen(function*() {
    const current = yield* Ref.get(state);
    const pages = Math.max(1, Math.ceil(current.assignments.length / appSlots.length));
    yield* render({ ...current, page: (current.page + direction + pages) % pages });
  }));
  const tapDial = (dial: number, key?: string, expectedPage?: number) => Semaphore.withPermits(screen, 1)(Effect.gen(function*() {
    const current = yield* Ref.get(state); const index = appSlots.findIndex((slot) => slot.dial === dial);
    const app = index < 0 ? undefined : current.apps.find((app) => app.key === current.assignments[current.page * appSlots.length + index]);
    if ((key !== undefined && app?.key !== key) || (expectedPage !== undefined && current.page !== expectedPage)) return yield* Effect.fail(new StreamDeckError({ reason: 'InvalidArgument', operation: 'mixer-tap', message: 'L’application ou la page a changé. Recharge le mixer.' }));
    if (app && extensions && (yield* extensions.tap(app))) yield* render(current);
  }));
  const binding = yield* Bindings.start({
    knobs: Object.fromEntries(slots.map((slot) => [slot.dial, {
      onRotate: ({ delta }: DialRotate) => enqueue(slot.dial, delta * step, 0),
      onPress: enqueue(slot.dial, 0, 1),
    }])),
    touch: { [lcd.index]: {
      area: { x: 0, y: 0, width: masterSlot.x, height: lcd.pixelSize.height },
      onTap: ({ position }) => Effect.flatMap(Ref.get(regions), (drawn) => {
        const slot = drawn.find((slot) => slot.dial !== masterSlot.dial && position.x >= slot.x && position.x < slot.x + slot.width);
        return slot ? tapDial(slot.dial) : Effect.void;
      }),
      onSwipe: ({ from, to }) => Math.abs(to.x - from.x) >= 30 && Math.abs(to.x - from.x) > Math.abs(to.y - from.y)
        ? changePage(to.x < from.x ? 1 : -1) : Effect.void,
    } },
    render: refresh,
  });
  const view = yield* Ref.get(state);
  yield* Console.log(JSON.stringify({ kind: 'mixer-ready', apps: view.apps.map((app) => ({ name: app.name, key: app.key, volume: Math.round(app.volume), muted: app.muted })), master: view.master, step, pages: Math.max(1, Math.ceil(view.assignments.length / appSlots.length)) }));
  return { state: Ref.get(state), regions: Ref.get(regions), refresh, flush, changePage, tapDial,
    adjustDial: (dial: number, ticks: number) => enqueue(dial, ticks * step, 0),
    toggleDial: (dial: number) => enqueue(dial, 0, 1),
    run: Effect.raceAllFirst([
      binding.run,
      Effect.forever(Effect.sleep(pollMillis).pipe(Effect.andThen(refresh))),
      Effect.forever(Effect.sleep(flushMillis).pipe(Effect.andThen(flush))),
    ]),
  };
});
export type Controller = Effect.Success<ReturnType<typeof make>>;
export class AudioMixer extends Context.Service<AudioMixer, Effect.Success<ReturnType<typeof make>>>()('@nixfiles/streamdeck/AudioMixer') {
  static readonly layer = (options: MixerOptions = {}) => Layer.effect(AudioMixer, make(options));
}
export const plugin = (options: MixerOptions = {}) => Plugin.fromLayer({
  id: 'audio-mixer', name: 'Mixer audio', description: 'Volumes des applications et Master, mute et pagination tactile.',
  controls: (deck: import('../stream-deck.ts').Device) => ({ dials: deck.dials.map((dial) => dial.index), lcds: deck.lcds[0] ? [deck.lcds[0].index] : [] }),
  supported: (deck) => !!deck.lcds[0]?.pixelSize && deck.dials.length >= 2,
  actions: [
    Plugin.action({ id: 'page', name: 'Page audio', description: 'Parcourt les applications ; Master reste fixe.', input: Schema.Struct({ direction: Schema.Literals([-1, 1]).annotate({ title: 'Direction', description: '−1 : précédente ; 1 : suivante.' }) }), defaults: { direction: 1 }, run: (api: Controller, { direction }) => api.changePage(direction) }),
    Plugin.action({ id: 'refresh', name: 'Actualiser les volumes', description: 'Relit les sources audio et leur volume.', input: Schema.Struct({}), defaults: {}, run: (api: Controller) => api.refresh }),
  ],
  service: AudioMixer, layer: AudioMixer.layer(options), run: (api) => api.run,
});
