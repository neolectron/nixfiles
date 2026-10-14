import { Cause, Clock, Deferred, Effect, Fiber, Schema, Semaphore } from 'effect';

/** One activation gesture per button; omission preserves immediate KeyDown behavior. */
export const KeyTrigger = Schema.Union([
  Schema.Struct({ type: Schema.Literal('press') }),
  Schema.Struct({ type: Schema.Literal('long-press'), milliseconds: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 10000 }))) }),
  Schema.Struct({ type: Schema.Literal('double-tap'), milliseconds: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 1000 }))) }),
]);
export type KeyTrigger = typeof KeyTrigger.Type;
export const delay = (trigger: KeyTrigger) => trigger.type === 'press' ? 0 : trigger.milliseconds ?? (trigger.type === 'long-press' ? 600 : 350);

/** Scoped Effect timers. Identity/context keep presses on different pages or sources independent. */
export const make = <E, R>() => Effect.gen(function*() {
  const scope = yield* Effect.scope; const lock = yield* Semaphore.make(1);
  const failed = yield* Deferred.make<never, E>();
  type Press = { identity: unknown; context: string | undefined; trigger: KeyTrigger; started: number; fire: Effect.Effect<unknown, E, R>; timer?: Fiber.Fiber<unknown, E> };
  const held = new Map<string, Press>(); const taps = new Map<string, { identity: unknown; context: string | undefined; finished: number }>();
  yield* Effect.addFinalizer(() => Effect.sync(() => { held.clear(); taps.clear(); }));
  const down = (key: string, options: { identity: unknown; context?: string; trigger?: KeyTrigger; fire: Effect.Effect<unknown, E, R> }) => Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
    if (held.has(key)) return; // Repeated/bouncing KeyDown never arms a second timer.
    const trigger = options.trigger ?? { type: 'press' as const };
    const press: Press = { ...options, context: options.context, trigger, started: yield* Clock.currentTimeMillis };
    const previous = taps.get(key); if (previous?.identity !== options.identity) taps.delete(key);
    held.set(key, press);
    if (trigger.type === 'press') { taps.delete(key); yield* press.fire; }
    else if (trigger.type === 'long-press') {
      taps.delete(key);
      press.timer = yield* Effect.forkIn(Effect.sleep(delay(trigger)).pipe(Effect.andThen(Semaphore.withPermits(lock, 1)(
        Effect.suspend(() => held.get(key) === press ? press.fire : Effect.void),
      )), Effect.tapCause((cause) => Cause.hasInterruptsOnly(cause) ? Effect.void : Deferred.failCause(failed, cause))), scope);
    }
  }));
  const up = (key: string, context?: string) => Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
    const press = held.get(key); if (!press || (context !== undefined && press.context !== context)) return;
    held.delete(key); if (press.timer) yield* Fiber.interrupt(press.timer);
    if (press.trigger.type !== 'double-tap') return;
    const now = yield* Clock.currentTimeMillis; const window = delay(press.trigger); const previous = taps.get(key);
    // Both presses must be short, with the second release inside the interval following the first.
    if (now - press.started > window) { taps.delete(key); return; }
    if (previous && previous.identity === press.identity && now - previous.finished <= window) { taps.delete(key); yield* press.fire; }
    else taps.set(key, { identity: press.identity, context: press.context, finished: now });
  }));
  const cancel = (key: string, context?: string) => Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
    const press = held.get(key);
    if (press && (context === undefined || press.context === context)) { held.delete(key); if (press.timer) yield* Fiber.interrupt(press.timer); }
    const tap = taps.get(key); if (tap && (context === undefined || tap.context === context)) taps.delete(key);
  }));
  return { down, up, cancel, failure: Deferred.await(failed) };
});
