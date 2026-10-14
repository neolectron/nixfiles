import { Effect, Ref, Schema, Semaphore, Stream } from 'effect';
import * as Gestures from './press-gestures.ts';
import { KeyTrigger, PressTiming } from './press-trigger.ts';
import * as Tasks from './task-runner.ts';
import { invalid, invariant } from './errors.ts';
import type { RgbImage } from './image.ts';
import type {
  DeckEvent,
  DialDown,
  DialRotate,
  DialUp,
  KeyDown,
  KeyUp,
  Position,
  Size,
  TouchHold,
  TouchSwipe,
  TouchTap,
} from './model.ts';
import { StreamDeck, type Device } from './stream-deck.ts';
const isBackground = <Event, E, R>(value: Handler<Event, E, R>): value is Background<Event, E, R> =>
  typeof value === 'object' && '_tag' in value && value._tag === 'BackgroundHandler';
type Sequential<Event, E, R> =
  | Effect.Effect<unknown, E, R>
  | ((event: Event) => Effect.Effect<unknown, E, R>);
export interface Background<Event, E, R> {
  readonly _tag: 'BackgroundHandler';
  readonly handler: Sequential<Event, E, R>;
}
export type Handler<Event, E, R> = Sequential<Event, E, R> | Background<Event, E, R>;
/** Opt into supervised concurrency, especially for actions that await released. */
export const background = <Event, E, R>(
  handler: Sequential<Event, E, R>,
): Background<Event, E, R> => ({ _tag: 'BackgroundHandler', handler });
export type PressEvent<Event> = Event & Gestures.PressContext;
export interface PressBinding<Down, Up, E, R> {
  /** Legacy single activation mode for onPress. Use semantic handlers to combine gestures. */
  readonly trigger?: KeyTrigger;
  readonly onPress?: Handler<PressEvent<Down>, E, R>;
  readonly onRelease?: Handler<Up, E, R>;
  readonly onShortPress?: Handler<PressEvent<Down>, E, R>;
  readonly onLongPress?: Handler<PressEvent<Down>, E, R>;
  readonly onDoubleTap?: Handler<PressEvent<Down>, E, R>;
  readonly longPressMs?: number;
  readonly doubleTapMs?: number;
}
export interface Button<E, R> extends PressBinding<KeyDown, KeyUp, E, R> {
  readonly label?: string;
  readonly image?: RgbImage;
}
export interface Knob<E, R> extends PressBinding<DialDown, DialUp, E, R> {
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
const invoke = <Event, E, R>(
  handler: Handler<Event, E, R> | undefined,
  event: Event,
  submit: (task: Effect.Effect<unknown, E, R>) => Effect.Effect<void, never, R>,
): Effect.Effect<void, E, R> => {
  if (handler === undefined) return Effect.void;
  if (isBackground(handler)) {
    const task = handler.handler;
    return submit(typeof task === 'function' ? Effect.suspend(() => task(event)) : task);
  }
  return Effect.asVoid(
    typeof handler === 'function' ? Effect.suspend(() => handler(event)) : handler,
  );
};
/** The same handlers can consume any event Stream, without a device or editor. */
export const listen = <A, E, R, E2, R2>(
  source: Stream.Stream<A, E, R>,
  handler: Handler<A, E2, R2>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const tasks = yield* Tasks.make<E2, R2>();
      const route = Stream.runForEach(source, (event) => invoke(handler, event, tasks.submit)).pipe(
        Effect.andThen(tasks.drain),
      );
      yield* Effect.raceFirst(route, tasks.failure);
    }),
  );
const validate = <E, R>(deck: Device, profile: Profile<E, R>) =>
  Effect.gen(function* () {
    for (const [kind, bindings, controls] of [
      ['button', profile.buttons, deck.buttons],
      ['knob', profile.knobs, deck.dials],
      ['touch', profile.touch, deck.lcds],
    ] as const) {
      for (const value of Object.keys(bindings ?? {})) {
        const index = Number(value);
        if (
          !Number.isSafeInteger(index) ||
          index < 0 ||
          String(index) !== value ||
          !controls.some((control) => control.index === index)
        ) {
          return yield* Effect.fail(
            invalid('bindings', `No ${kind} ${value} on ${deck.info.model}.`),
          );
        }
      }
    }
    for (const binding of [
      ...Object.values(profile.buttons ?? {}),
      ...Object.values(profile.knobs ?? {}),
    ]) {
      if (binding.trigger) {
        yield* Schema.decodeUnknownEffect(KeyTrigger)(binding.trigger).pipe(
          Effect.mapError(() => invalid('bindings', 'Invalid press trigger.')),
        );
        if (binding.onShortPress || binding.onLongPress || binding.onDoubleTap)
          return yield* Effect.fail(
            invalid('bindings', 'Use either trigger + onPress or semantic gesture handlers.'),
          );
      }
      yield* Schema.decodeUnknownEffect(PressTiming)(binding).pipe(
        Effect.mapError((error) => invalid('bindings', error.message)),
      );
    }
    for (const [index, button] of Object.entries(profile.buttons ?? {})) {
      if (button.label !== undefined && button.image !== undefined)
        return yield* Effect.fail(invalid('bindings', `Button ${index} has both label and image.`));
    }
    for (const [index, value] of Object.entries(profile.touch ?? {})) {
      const bindings = Array.isArray(value) ? value : [value as Touch<E, R>];
      const size = deck.lcds.find((control) => control.index === Number(index))?.pixelSize;
      for (const binding of bindings)
        if (binding.area) {
          const { x, y, width, height } = binding.area;
          if (
            !size ||
            ![x, y, width, height].every(Number.isSafeInteger) ||
            x < 0 ||
            y < 0 ||
            width <= 0 ||
            height <= 0 ||
            x + width > size.width ||
            y + height > size.height
          )
            return yield* Effect.fail(invalid('bindings', 'Touch area must fit inside the LCD.'));
        }
    }
  });
const render = <E, R>(
  deck: Device,
  profile: Profile<E, R>,
  ownedKeys: ReadonlyArray<number> = [],
) =>
  Effect.gen(function* () {
    for (const index of ownedKeys) {
      const button = profile.buttons?.[index];
      if (
        button?.label === undefined &&
        button?.image === undefined &&
        deck.buttons.find((key) => key.index === index)?.feedbackType === 'lcd'
      )
        yield* deck.key(index).clear;
    }
    for (const [index, button] of Object.entries(profile.buttons ?? {})) {
      if (button.image) yield* deck.key(Number(index)).setImage(button.image);
      else if (button.label !== undefined) yield* deck.key(Number(index)).label(button.label);
    }
    if (profile.render) yield* profile.render;
  });
// One sequential router preserves input order. Background handlers submit work
// to the supervised task owner, leaving releases and subsequent inputs responsive.
const router = <E, R>(
  current: Effect.Effect<Profile<E, R>>,
  events: Stream.Stream<DeckEvent, import('./errors.ts').StreamDeckError>,
) =>
  Effect.gen(function* () {
    const gestures = yield* Gestures.make<E, R>();
    const tasks = yield* Tasks.make<E, R>();
    const call = <Event>(handler: Handler<Event, E, R> | undefined, event: Event) =>
      invoke(handler, event, tasks.submit);
    const heldKeys = new Map<number, Profile<E, R>>();
    const heldDials = new Map<number, Profile<E, R>>();
    const down = <Down extends KeyDown | DialDown, Up>(
      key: string,
      binding: PressBinding<Down, Up, E, R> | undefined,
      event: Down,
      profile: Profile<E, R>,
    ) => {
      if (!binding) return Effect.void;
      const handler =
        (value: Handler<PressEvent<Down>, E, R> | undefined) => (context: Gestures.PressContext) =>
          call(value, { ...event, ...context });
      const active = Effect.map(current, (now) => now === profile);
      return gestures.down(key, {
        identity: profile,
        active,
        handlers: binding.trigger
          ? Gestures.activation(binding.trigger, handler(binding.onPress))
          : {
              ...(binding.onPress ? { onPress: handler(binding.onPress) } : {}),
              ...(binding.onShortPress ? { onShortPress: handler(binding.onShortPress) } : {}),
              ...(binding.onLongPress ? { onLongPress: handler(binding.onLongPress) } : {}),
              ...(binding.onDoubleTap ? { onDoubleTap: handler(binding.onDoubleTap) } : {}),
              ...(binding.longPressMs !== undefined ? { longPressMs: binding.longPressMs } : {}),
              ...(binding.doubleTapMs !== undefined ? { doubleTapMs: binding.doubleTapMs } : {}),
            },
      });
    };
    const route = Stream.runForEach(events, (event) =>
      Effect.gen(function* () {
        let profile = yield* current;
        if (event._tag === 'KeyDown') {
          if (heldKeys.has(event.key)) profile = invariant(heldKeys.get(event.key), 'bindings');
          else heldKeys.set(event.key, profile);
        } else if (event._tag === 'KeyUp') {
          profile = heldKeys.get(event.key) ?? profile;
          heldKeys.delete(event.key);
        } else if (event._tag === 'DialDown') {
          if (heldDials.has(event.dial)) profile = invariant(heldDials.get(event.dial), 'bindings');
          else heldDials.set(event.dial, profile);
        } else if (event._tag === 'DialUp') {
          profile = heldDials.get(event.dial) ?? profile;
          heldDials.delete(event.dial);
        }
        if (profile.onEvent) yield* profile.onEvent(event);
        switch (event._tag) {
          case 'KeyDown':
            yield* down(`key/${event.key}`, profile.buttons?.[event.key], event, profile);
            break;
          case 'KeyUp':
            yield* gestures.up(`key/${event.key}`);
            yield* call(profile.buttons?.[event.key]?.onRelease, event);
            break;
          case 'DialDown':
            yield* down(`dial/${event.dial}`, profile.knobs?.[event.dial], event, profile);
            break;
          case 'DialUp':
            yield* gestures.up(`dial/${event.dial}`);
            yield* call(profile.knobs?.[event.dial]?.onRelease, event);
            break;
          case 'DialRotate':
            yield* call(profile.knobs?.[event.dial]?.onRotate, event);
            break;
          default: {
            const value = profile.touch?.[event.lcd];
            const bindings: ReadonlyArray<Touch<E, R>> =
              value === undefined ? [] : Array.isArray(value) ? value : [value as Touch<E, R>];
            const position = event._tag === 'TouchSwipe' ? event.from : event.position;
            const touch = bindings.find(
              ({ area }) =>
                !area ||
                (position.x >= area.x &&
                  position.x < area.x + area.width &&
                  position.y >= area.y &&
                  position.y < area.y + area.height),
            );
            if (event._tag === 'TouchTap') yield* call(touch?.onTap, event);
            else if (event._tag === 'TouchHold') yield* call(touch?.onHold, event);
            else yield* call(touch?.onSwipe, event);
          }
        }
      }),
    );
    yield* Effect.raceFirst(route, Effect.raceFirst(gestures.failure, tasks.failure));
  }).pipe(Effect.scoped);
/** Set up feedback and subscription deterministically; run in the same scope. */
export const start = <E, R>(profile: Profile<E, R>) =>
  Effect.gen(function* () {
    const deck = yield* StreamDeck;
    yield* validate(deck, profile);
    const events = yield* deck.subscribe;
    yield* render(deck, profile);
    return { run: Effect.raceFirst(router(Effect.succeed(profile), events), deck.awaitFailure) };
  });
export const run = <E, R>(profile: Profile<E, R>) =>
  Effect.scoped(Effect.flatMap(start(profile), (binding) => binding.run));
/** Explicit, script-controlled pages. Releases go back to the press's page. */
export const pages = <Name extends string, E, R>(
  profiles: Readonly<Record<Name, Profile<E, R>>>,
  initial: NoInfer<Name>,
) =>
  Effect.gen(function* () {
    const deck = yield* StreamDeck;
    if (!Object.hasOwn(profiles, initial))
      return yield* Effect.fail(invalid('page', `Unknown page ${initial}.`));
    for (const profile of Object.values(profiles) as Profile<E, R>[])
      yield* validate(deck, profile);
    const current = yield* Ref.make(initial);
    const active = yield* Ref.make<Profile<E, R>>({ ...profiles[initial] });
    const lock = yield* Semaphore.make(1);
    const ownedKeys = [
      ...new Set(
        (Object.values(profiles) as Profile<E, R>[]).flatMap((profile) =>
          Object.keys(profile.buttons ?? {}).map(Number),
        ),
      ),
    ];
    const select = (name: Name) =>
      Semaphore.withPermits(
        lock,
        1,
      )(
        Effect.gen(function* () {
          if (!Object.hasOwn(profiles, name))
            return yield* Effect.fail(invalid('page', `Unknown page ${name}.`));
          yield* render(deck, profiles[name], ownedKeys);
          yield* Ref.set(current, name);
          yield* Ref.set(active, { ...profiles[name] });
        }),
      );
    const events = yield* deck.subscribe;
    yield* select(initial);
    return {
      select,
      current: Ref.get(current),
      run: Effect.raceFirst(router(Ref.get(active), events), deck.awaitFailure),
    };
  });
