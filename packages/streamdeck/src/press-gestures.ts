import { Cause, Clock, Deferred, Effect, Fiber, Schema, Semaphore } from 'effect';
import { defaults, delay, KeyTrigger, PressTiming } from './press-trigger.ts';
import { invalid } from './errors.ts';
const invoke = <E, R>(
  press: { active: Effect.Effect<boolean>; release: Deferred.Deferred<void> },
  handler: Handler<E, R> | undefined,
  gesture: PressGesture = 'press',
) =>
  Effect.gen(function* () {
    if (!handler || !(yield* press.active)) return;
    yield* typeof handler === 'function'
      ? Effect.suspend(() => handler({ released: Deferred.await(press.release), gesture }))
      : handler;
  });
/** One release signal per physical press. Cancellation also completes it. */
export type PressGesture = 'press' | 'short-press' | 'long-press' | 'double-tap';
export interface PressContext {
  readonly released: Effect.Effect<void>;
  readonly gesture: PressGesture;
}
export type Handler<E, R> =
  | Effect.Effect<unknown, E, R>
  | ((context: PressContext) => Effect.Effect<unknown, E, R>);
export interface Handlers<E, R> {
  /** Immediate down; independent of the mutually exclusive semantic gestures. */
  readonly onPress?: Handler<E, R>;
  readonly onShortPress?: Handler<E, R>;
  readonly onLongPress?: Handler<E, R>;
  readonly onDoubleTap?: Handler<E, R>;
  readonly longPressMs?: number;
  readonly doubleTapMs?: number;
}
/** Adapt a persisted single-gesture choice to the same semantic handlers. */
export const activation = <E, R>(trigger: KeyTrigger, handler: Handler<E, R>): Handlers<E, R> =>
  trigger.type === 'press'
    ? { onPress: handler }
    : trigger.type === 'long-press'
      ? { onLongPress: handler, longPressMs: delay(trigger) }
      : { onDoubleTap: handler, doubleTapMs: delay(trigger) };
export type Options<E, R> = {
  readonly identity: unknown;
  readonly context?: string;
  /** Checked again at activation: navigating away and back cannot fire an old press. */
  readonly active?: Effect.Effect<boolean>;
} & (
  | {
      readonly handlers: Handlers<E, R>;
    }
  | {
      readonly trigger?: KeyTrigger;
      readonly fire: Effect.Effect<unknown, E, R>;
    }
);
/** Input-independent gesture arbitration, shared by keys, encoders and custom sources.
 * Callbacks dispatch sequentially; use forkIn/forkScoped for long-running actions.
 */
export const make = <E, R>() =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const lock = yield* Semaphore.make(1);
    const failed = yield* Deferred.make<never, E>();
    type Press = {
      identity: unknown;
      context: string | undefined;
      started: number;
      handlers: Handlers<E, R>;
      active: Effect.Effect<boolean>;
      release: Deferred.Deferred<void>;
      long: boolean;
      timer?: Fiber.Fiber<unknown, E>;
      previous?: Tap;
    };
    type Tap = {
      press: Press;
      finished: number;
      timer?: Fiber.Fiber<unknown, E>;
    };
    const held = new Map<string, Press>();
    const taps = new Map<string, Tap>();
    const timer = (milliseconds: number, run: Effect.Effect<unknown, E, R>) =>
      Effect.forkIn(
        Effect.sleep(milliseconds).pipe(
          Effect.andThen(Semaphore.withPermits(lock, 1)(run)),
          Effect.tapCause((cause) =>
            Cause.hasInterruptsOnly(cause) ? Effect.void : Deferred.failCause(failed, cause),
          ),
        ),
        scope,
      );
    const dropTap = (key: string) =>
      Effect.gen(function* () {
        const tap = taps.get(key);
        taps.delete(key);
        if (tap?.timer) yield* Fiber.interrupt(tap.timer);
        return tap;
      });
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        for (const press of held.values()) yield* Deferred.succeed(press.release, undefined);
        held.clear();
        taps.clear();
      }),
    );
    const down = (key: string, options: Options<E, R>) =>
      Semaphore.withPermits(
        lock,
        1,
      )(
        Effect.gen(function* () {
          if (held.has(key)) return;
          const handlers: Handlers<E, R> =
            'handlers' in options
              ? options.handlers
              : activation(
                  yield* Schema.decodeUnknownEffect(KeyTrigger)(
                    options.trigger ?? { type: 'press' },
                  ).pipe(Effect.mapError((error) => invalid('gesture', error.message))),
                  options.fire,
                );
          yield* Schema.decodeUnknownEffect(PressTiming)(handlers).pipe(
            Effect.mapError((error) => invalid('gesture', error.message)),
          );
          const now = yield* Clock.currentTimeMillis;
          const previous = yield* dropTap(key);
          const press: Press = {
            identity: options.identity,
            context: options.context,
            handlers,
            started: now,
            active: options.active ?? Effect.succeed(true),
            release: yield* Deferred.make<void>(),
            long: false,
          };
          if (
            previous &&
            previous.press.identity === press.identity &&
            previous.press.context === press.context &&
            now - previous.finished <= (handlers.doubleTapMs ?? defaults.doubleTapMs)
          )
            press.previous = previous;
          else if (previous)
            yield* invoke(previous.press, previous.press.handlers.onShortPress, 'short-press');
          held.set(key, press);
          if (handlers.onLongPress)
            press.timer = yield* timer(
              handlers.longPressMs ?? defaults.longPressMs,
              Effect.suspend(() => {
                if (held.get(key) !== press) return Effect.void;
                press.long = true;
                delete press.previous;
                return invoke(press, handlers.onLongPress, 'long-press');
              }),
            );
          yield* invoke(press, handlers.onPress);
        }),
      );
    const up = (key: string, context?: string) =>
      Semaphore.withPermits(
        lock,
        1,
      )(
        Effect.gen(function* () {
          const press = held.get(key);
          if (!press || (context !== undefined && press.context !== context)) return;
          held.delete(key);
          yield* Deferred.succeed(press.release, undefined);
          if (press.timer) yield* Fiber.interrupt(press.timer);
          const now = yield* Clock.currentTimeMillis;
          const { handlers } = press;
          const window = handlers.doubleTapMs ?? defaults.doubleTapMs;
          const maximum = handlers.onLongPress
            ? (handlers.longPressMs ?? defaults.longPressMs)
            : handlers.onDoubleTap
              ? window
              : Infinity;
          if (
            press.long ||
            (handlers.onLongPress && now - press.started >= maximum) ||
            now - press.started > maximum
          )
            return;
          if (!handlers.onDoubleTap) {
            yield* invoke(press, handlers.onShortPress, 'short-press');
            return;
          }
          if (press.previous && now - press.previous.finished <= window) {
            yield* invoke(press, handlers.onDoubleTap, 'double-tap');
            return;
          }
          if (press.previous)
            yield* invoke(
              press.previous.press,
              press.previous.press.handlers.onShortPress,
              'short-press',
            );
          const tap: Tap = { press, finished: now };
          taps.set(key, tap);
          // A double-only binding needs no timer. Its expired tap is discarded on the next down.
          if (handlers.onShortPress)
            tap.timer = yield* timer(
              window,
              Effect.suspend(() => {
                if (taps.get(key) !== tap) return Effect.void;
                taps.delete(key);
                return invoke(press, handlers.onShortPress, 'short-press');
              }),
            );
        }),
      );
    const cancel = (key: string, context?: string) =>
      Semaphore.withPermits(
        lock,
        1,
      )(
        Effect.gen(function* () {
          const press = held.get(key);
          if (press && (context === undefined || press.context === context)) {
            held.delete(key);
            yield* Deferred.succeed(press.release, undefined);
            if (press.timer) yield* Fiber.interrupt(press.timer);
          }
          const tap = taps.get(key);
          if (tap && (context === undefined || tap.press.context === context)) yield* dropTap(key);
        }),
      );
    return { down, up, cancel, failure: Deferred.await(failed) };
  });
