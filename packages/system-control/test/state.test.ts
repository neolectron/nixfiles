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

it.effect('overlapping refreshes cannot publish an old snapshot after a newer read', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let source = 0;
      let reads = 0;
      const store = yield* State.polling(
        Effect.gen(function* () {
          const value = source;
          if (++reads === 2) {
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(release);
          }
          return value;
        }),
        '1 minute',
        new IntegrationError({ message: 'Offline' }),
      );
      source = 1;
      const first = yield* store.refresh.pipe(Effect.forkScoped);
      yield* Deferred.await(started);
      source = 2;
      const second = yield* store.refresh.pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      assert.strictEqual(reads, 2);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      assert.strictEqual(yield* store.state, 2);
    }),
  ),
);
