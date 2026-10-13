import { Effect, Ref, Semaphore, Stream } from 'effect';
import { invalid } from './errors.ts';
import type { RgbImage } from './image.ts';
import type { DeckEvent, DialDown, DialRotate, DialUp, KeyDown, KeyUp, Position, Size, TouchHold, TouchSwipe, TouchTap } from './model.ts';
import { StreamDeck, type Device } from './stream-deck.ts';

export type Handler<Event, E, R> = Effect.Effect<unknown, E, R> | ((event: Event) => Effect.Effect<unknown, E, R>);
export interface Button<E, R> {
  readonly label?: string;
  readonly image?: RgbImage;
  readonly onPress?: Handler<KeyDown, E, R>;
  readonly onRelease?: Handler<KeyUp, E, R>;
}
export interface Knob<E, R> {
  readonly onPress?: Handler<DialDown, E, R>;
  readonly onRelease?: Handler<DialUp, E, R>;
  readonly onRotate?: Handler<DialRotate, E, R>;
}
export interface Touch<E, R> {
  readonly area?: Position & Size;
  readonly onTap?: Handler<TouchTap, E, R>;
  readonly onHold?: Handler<TouchHold, E, R>;
  readonly onSwipe?: Handler<TouchSwipe, E, R>;
}
export interface Profile<E = never, R = never> {
  readonly buttons?: Readonly<Record<number, Button<E, R>>>;
  readonly knobs?: Readonly<Record<number, Knob<E, R>>>;
  /** First matching area wins. A swipe is assigned by its starting position. */
  readonly touch?: Readonly<Record<number, Touch<E, R> | ReadonlyArray<Touch<E, R>>>>;
  readonly render?: Effect.Effect<unknown, E, R>;
  readonly onEvent?: (event: DeckEvent) => Effect.Effect<unknown, E, R>;
}
const invoke = <Event, E, R>(handler: Handler<Event, E, R> | undefined, event: Event): Effect.Effect<void, E, R> =>
  handler === undefined ? Effect.void : Effect.asVoid(typeof handler === 'function' ? Effect.suspend(() => handler(event)) : handler);

const validate = <E, R>(deck: Device, profile: Profile<E, R>) => Effect.gen(function*() {
  for (const [kind, bindings, controls] of [
    ['button', profile.buttons, deck.buttons], ['knob', profile.knobs, deck.dials], ['touch', profile.touch, deck.lcds],
  ] as const) {
    for (const value of Object.keys(bindings ?? {})) {
      const index = Number(value);
      if (!Number.isSafeInteger(index) || index < 0 || String(index) !== value || !controls.some((control) => control.index === index)) {
        return yield* Effect.fail(invalid('bindings', `No ${kind} ${value} on ${deck.info.model}.`));
      }
    }
  }
  for (const [index, button] of Object.entries(profile.buttons ?? {})) {
    if (button.label !== undefined && button.image !== undefined) return yield* Effect.fail(invalid('bindings', `Button ${index} has both label and image.`));
  }
  for (const [index, value] of Object.entries(profile.touch ?? {})) {
    const bindings = Array.isArray(value) ? value : [value as Touch<E, R>];
    const size = deck.lcds.find((control) => control.index === Number(index))?.pixelSize;
    for (const binding of bindings) if (binding.area) {
      const { x, y, width, height } = binding.area;
      if (!size || ![x, y, width, height].every(Number.isSafeInteger) || x < 0 || y < 0 || width <= 0 || height <= 0
        || x + width > size.width || y + height > size.height) return yield* Effect.fail(invalid('bindings', 'Touch area must fit inside the LCD.'));
    }
  }
});

const render = <E, R>(deck: Device, profile: Profile<E, R>, ownedKeys: ReadonlyArray<number> = []) => Effect.gen(function*() {
  for (const index of ownedKeys) {
    const button = profile.buttons?.[index];
    if (button?.label === undefined && button?.image === undefined && deck.buttons.find((key) => key.index === index)?.feedbackType === 'lcd') yield* deck.key(index).clear;
  }
  for (const [index, button] of Object.entries(profile.buttons ?? {})) {
    if (button.image) yield* deck.key(Number(index)).setImage(button.image);
    else if (button.label !== undefined) yield* deck.key(Number(index)).label(button.label);
  }
  if (profile.render) yield* profile.render;
});

// One sequential router preserves press/release and rotation order. Long background
// work can be explicitly forkScoped by a script, so its lifecycle stays visible.
const router = <E, R>(current: Effect.Effect<Profile<E, R>>, events: Stream.Stream<DeckEvent, import('./errors.ts').StreamDeckError>) => {
  const heldKeys = new Map<number, Profile<E, R>>();
  const heldDials = new Map<number, Profile<E, R>>();
  return Stream.runForEach(events, (event) => Effect.gen(function*() {
    let profile = yield* current;
    if (event._tag === 'KeyDown') heldKeys.set(event.key, profile);
    else if (event._tag === 'KeyUp') { profile = heldKeys.get(event.key) ?? profile; heldKeys.delete(event.key); }
    else if (event._tag === 'DialDown') heldDials.set(event.dial, profile);
    else if (event._tag === 'DialUp') { profile = heldDials.get(event.dial) ?? profile; heldDials.delete(event.dial); }
    if (profile.onEvent) yield* profile.onEvent(event);
    switch (event._tag) {
      case 'KeyDown': yield* invoke(profile.buttons?.[event.key]?.onPress, event); break;
      case 'KeyUp': yield* invoke(profile.buttons?.[event.key]?.onRelease, event); break;
      case 'DialDown': yield* invoke(profile.knobs?.[event.dial]?.onPress, event); break;
      case 'DialUp': yield* invoke(profile.knobs?.[event.dial]?.onRelease, event); break;
      case 'DialRotate': yield* invoke(profile.knobs?.[event.dial]?.onRotate, event); break;
      default: {
        const value = profile.touch?.[event.lcd];
        const bindings: ReadonlyArray<Touch<E, R>> = value === undefined ? [] : Array.isArray(value) ? value : [value as Touch<E, R>];
        const position = event._tag === 'TouchSwipe' ? event.from : event.position;
        const touch = bindings.find(({ area }) => !area || (position.x >= area.x && position.x < area.x + area.width && position.y >= area.y && position.y < area.y + area.height));
        if (event._tag === 'TouchTap') yield* invoke(touch?.onTap, event);
        else if (event._tag === 'TouchHold') yield* invoke(touch?.onHold, event);
        else yield* invoke(touch?.onSwipe, event);
      }
    }
  }));
};

/** Set up feedback and subscription deterministically; run in the same scope. */
export const start = <E, R>(profile: Profile<E, R>) => Effect.gen(function*() {
  const deck = yield* StreamDeck;
  yield* validate(deck, profile);
  const events = yield* deck.subscribe;
  yield* render(deck, profile);
  return { run: Effect.raceFirst(router(Effect.succeed(profile), events), deck.awaitFailure) };
});
export const run = <E, R>(profile: Profile<E, R>) => Effect.scoped(Effect.flatMap(start(profile), (binding) => binding.run));

/** Explicit, script-controlled pages. Releases go back to the press's page. */
export const pages = <Name extends string, E, R>(profiles: Readonly<Record<Name, Profile<E, R>>>, initial: NoInfer<Name>) => Effect.gen(function*() {
  const deck = yield* StreamDeck;
  if (!Object.hasOwn(profiles, initial)) return yield* Effect.fail(invalid('page', `Unknown page ${initial}.`));
  for (const profile of Object.values(profiles) as Profile<E, R>[]) yield* validate(deck, profile);
  const current = yield* Ref.make(initial);
  const lock = yield* Semaphore.make(1);
  const ownedKeys = [...new Set((Object.values(profiles) as Profile<E, R>[]).flatMap((profile) => Object.keys(profile.buttons ?? {}).map(Number)))];
  const select = (name: Name) => Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
    if (!Object.hasOwn(profiles, name)) return yield* Effect.fail(invalid('page', `Unknown page ${name}.`));
    yield* render(deck, profiles[name], ownedKeys);
    yield* Ref.set(current, name);
  }));
  const events = yield* deck.subscribe;
  yield* select(initial);
  return {
    select, current: Ref.get(current),
    run: Effect.raceFirst(router(Effect.map(Ref.get(current), (name) => profiles[name]), events), deck.awaitFailure),
  };
});
