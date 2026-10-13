import { Console, Effect, Ref, Semaphore } from 'effect';
import { Audio, type Application, type Change, type Master } from '../audio.ts';
import * as Bindings from '../bindings.ts';
import { StreamDeck } from '../stream-deck.ts';
import { StreamDeckError } from '../errors.ts';
import type { Control, DialRotate, Position, Size } from '../model.ts';
import * as Display from '../mixer-renderer.ts';
import { volumeColor } from '../volume-gauge.ts';

export interface MixerOptions { readonly step?: number; readonly refreshMillis?: number; readonly flushMillis?: number; readonly renderer?: Display.RendererKind }
export interface MixerState {
  readonly apps: ReadonlyArray<Application>;
  readonly assignments: ReadonlyArray<string | null>;
  readonly page: number;
  readonly online: boolean;
  readonly master: Master | undefined;
  readonly masterOnline: boolean;
}
/** Existing apps keep their slots. New apps fill holes rather than moving neighbors. */
export const assign = (previous: ReadonlyArray<string | null>, apps: ReadonlyArray<Application>): ReadonlyArray<string | null> => {
  const keys = new Set(apps.map((app) => app.key));
  const slots = previous.map((key) => key !== null && keys.has(key) ? key : null);
  for (const app of apps) if (!slots.includes(app.key)) {
    const hole = slots.indexOf(null);
    if (hole >= 0) slots[hole] = app.key; else slots.push(app.key);
  }
  while (slots.length && slots.at(-1) === null) slots.pop();
  return slots;
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
export const startMixer = (options: MixerOptions = {}) => Effect.gen(function*() {
  const deck = yield* StreamDeck;
  const audio = yield* Audio;
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
  const render = (next: MixerState) => Effect.gen(function*() {
    let changed = false;
    for (const [i, slot] of slots.entries()) {
      const isMaster = slot.dial === masterSlot.dial;
      const app = isMaster ? next.master : next.apps.find((app) => app.key === next.assignments[next.page * appSlots.length + i]);
      const online = isMaster ? next.masterOnline : next.online;
      const stamp = JSON.stringify([online, app?.name, app && Math.round(app.volume), app?.muted, app && 'mixedMute' in app && app.mixedMute, app && volumeColor(app.volume)]);
      if (cache.get(i) === stamp) continue;
      yield* deck.lcd(lcd.index).drawRegion(slot, yield* display.card(slot, app, online, isMaster ? 'MASTER' : undefined));
      cache.set(i, stamp);
      changed = true;
    }
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
    const apps = yield* audio.list.pipe(Effect.catch((error) => Effect.gen(function*() {
      if (before.online) yield* Effect.logWarning('Audio unavailable', error.message);
      return undefined;
    })));
    const master = yield* audio.master.pipe(Effect.map((value) => ({ value, online: true })), Effect.catch((error) => Effect.gen(function*() {
      if (before.masterOnline) yield* Effect.logWarning('Master unavailable', error.message);
      return { value: undefined, online: false };
    })));
    const assignments = apps ? assign(before.assignments, apps) : before.assignments;
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
  const binding = yield* Bindings.start({
    knobs: Object.fromEntries(slots.map((slot) => [slot.dial, {
      onRotate: ({ delta }: DialRotate) => enqueue(slot.dial, delta * step, 0),
      onPress: enqueue(slot.dial, 0, 1),
    }])),
    touch: { [lcd.index]: {
      area: { x: 0, y: 0, width: masterSlot.x, height: lcd.pixelSize.height },
      onSwipe: ({ from, to }) => Math.abs(to.x - from.x) >= 30 && Math.abs(to.x - from.x) > Math.abs(to.y - from.y)
        ? changePage(to.x < from.x ? 1 : -1) : Effect.void,
    } },
    render: refresh,
  });
  const view = yield* Ref.get(state);
  yield* Console.log(JSON.stringify({ kind: 'mixer-ready', apps: view.apps.map((app) => ({ name: app.name, key: app.key, volume: Math.round(app.volume), muted: app.muted })), master: view.master, step, pages: Math.max(1, Math.ceil(view.assignments.length / appSlots.length)) }));
  return { state: Ref.get(state), refresh, flush, changePage,
    adjustDial: (dial: number, ticks: number) => enqueue(dial, ticks * step, 0),
    toggleDial: (dial: number) => enqueue(dial, 0, 1),
    run: Effect.raceAllFirst([
      binding.run,
      Effect.forever(Effect.sleep(pollMillis).pipe(Effect.andThen(refresh))),
      Effect.forever(Effect.sleep(flushMillis).pipe(Effect.andThen(flush))),
    ]),
  };
});
export const mixer = (options: MixerOptions = {}) => Effect.scoped(Effect.flatMap(startMixer(options), (controller) => controller.run));
