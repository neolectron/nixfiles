import { Cause, Deferred, Effect, Fiber } from 'effect';

/** Supervised background actions: inputs remain responsive, failures reach the owner. */
export const make = <E, R>() => Effect.gen(function*() {
  const scope = yield* Effect.scope;
  const failed = yield* Deferred.make<never, E>();
  const pending = new Map<symbol, Fiber.Fiber<unknown, E>>();
  const submit = (task: Effect.Effect<unknown, E, R>) => Effect.gen(function*() {
    const id = Symbol(); const ready = yield* Deferred.make<void>();
    const fiber = yield* Effect.forkIn(Deferred.await(ready).pipe(Effect.andThen(Effect.scoped(task)),
      Effect.tapCause((cause) => Cause.hasInterruptsOnly(cause) ? Effect.void : Deferred.failCause(failed, cause)),
      Effect.ensuring(Effect.sync(() => { pending.delete(id); }))), scope);
    pending.set(id, fiber); yield* Deferred.succeed(ready, undefined);
  });
  /** Called after a finite source ends: dispatched actions must finish before its scope closes. */
  const drain = Effect.gen(function*() {
    if (yield* Deferred.isDone(failed)) yield* Deferred.await(failed);
    yield* Effect.forEach([...pending.values()], (fiber) => Fiber.join(fiber), { concurrency: 'unbounded', discard: true });
    if (yield* Deferred.isDone(failed)) yield* Deferred.await(failed);
  });
  return { submit, drain, failure: Deferred.await(failed) };
});
