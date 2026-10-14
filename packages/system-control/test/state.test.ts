import { assert, it } from '@effect/vitest';
import { Deferred, Effect, Exit, Fiber, Ref, Result, Scope } from 'effect';
import * as State from '../src/state.ts';
import { IntegrationError } from '../src/errors.ts';

it.effect('closing a service cancels an in-flight operation and runs its finalizer', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const owner = yield* Scope.make();
      const store = yield* State.make<number, IntegrationError>(
        new IntegrationError({ message: 'Offline' }),
      ).pipe(Scope.provide(owner));
      const started = yield* Deferred.make<void>();
      const cleaned = yield* Ref.make(false);
      const operation = store.guard(
        Effect.acquireUseRelease(
          Deferred.succeed(started, undefined),
          () => Effect.never,
          () => Ref.set(cleaned, true),
        ),
      );
      const pending = yield* operation.pipe(Effect.forkScoped);
      yield* Deferred.await(started);
      yield* Scope.close(owner, Exit.void);
      assert.ok(Exit.hasInterrupts(yield* Fiber.await(pending)));
      assert.strictEqual(yield* Ref.get(cleaned), true);
      assert.strictEqual((yield* Effect.result(store.state))._tag, 'Failure');
    }),
  ),
);

it.effect('canceling a caller stops its operation without closing the shared service', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const store = yield* State.make<number, IntegrationError>(
        new IntegrationError({ message: 'Offline' }),
      );
      yield* store.publish(Result.succeed(42));
      const started = yield* Deferred.make<void>();
      const cleaned = yield* Ref.make(false);
      const pending = yield* store
        .guard(
          Effect.acquireUseRelease(
            Deferred.succeed(started, undefined),
            () => Effect.never,
            () => Ref.set(cleaned, true),
          ),
        )
        .pipe(Effect.forkScoped);
      yield* Deferred.await(started);
      yield* Fiber.interrupt(pending);
      assert.strictEqual(yield* Ref.get(cleaned), true);
      assert.strictEqual(yield* store.state, 42);
    }),
  ),
);
