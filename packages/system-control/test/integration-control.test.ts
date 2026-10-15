import { assert, it } from '@effect/vitest';
import { Deferred, Effect, Fiber, Layer, Option, Ref, Result, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { PersistentState } from '../src/persistent-state.ts';
import { StateStorage } from '../src/state-storage.ts';
import { IntegrationControl, make } from '../src/integration-control.ts';
import * as State from '../src/state.ts';
import * as Counters from '../src/counters.ts';
import { IntegrationError } from '../src/errors.ts';

const persistence = PersistentState.layer.pipe(Layer.provideMerge(StateStorage.layerMemory));
it.effect(
  'activation persists independently of plugin settings and stops polling until re-enabled',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const control = yield* make();
        let reads = 0;
        const service = yield* State.polling(
          Effect.sync(() => ++reads),
          100,
          new IntegrationError({ message: 'Offline' }),
          'audio',
        ).pipe(Effect.provideService(IntegrationControl, control));
        assert.strictEqual(reads, 1);
        yield* control.set('audio', false);
        assert.ok(Result.isFailure(yield* Effect.result(service.state)));
        yield* TestClock.adjust(500);
        assert.strictEqual(reads, 1);
        const restored = yield* make();
        assert.strictEqual(yield* restored.enabled('audio'), false);
        yield* control.set('audio', true);
        yield* TestClock.adjust(100);
        assert.strictEqual(yield* service.state, 2);
        assert.ok(Result.isFailure(yield* Effect.result(control.set('unknown', false))));
      }),
    ).pipe(Effect.provide(persistence)),
);
it.effect(
  'disabling an integration interrupts the session and command, runs cleanup and permits recovery',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const control = yield* make();
        const service = yield* State.make<number, IntegrationError>(
          new IntegrationError({ message: 'Offline' }),
          'obs',
        ).pipe(Effect.provideService(IntegrationControl, control));
        yield* service.publish(Result.succeed(7));
        const started = yield* Deferred.make<void>();
        const cleanup = yield* Ref.make(0);
        const session = yield* service
          .session(
            Effect.acquireUseRelease(
              Deferred.succeed(started, undefined),
              () => Effect.never,
              () => Ref.update(cleanup, (n) => n + 1),
            ),
          )
          .pipe(Effect.forkScoped);
        yield* Deferred.await(started);
        const commandStarted = yield* Deferred.make<void>();
        const command = yield* service
          .guard(Deferred.succeed(commandStarted, undefined).pipe(Effect.andThen(Effect.never)))
          .pipe(Effect.forkScoped);
        yield* Deferred.await(commandStarted);
        yield* control.set('obs', false);
        yield* Fiber.join(session);
        assert.ok(Result.isFailure(yield* Effect.result(Fiber.join(command))));
        assert.strictEqual(yield* Ref.get(cleanup), 1);
        yield* control.set('obs', true);
        assert.ok(Result.isFailure(yield* Effect.result(service.state)));
        yield* service.publish(Result.succeed(10));
        assert.strictEqual(yield* service.state, 10);
      }),
    ).pipe(Effect.provide(persistence)),
);
it.effect(
  'counter instances persist atomically, survive recreation and reset through configuration epochs',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const counters = yield* Counters.make('counter.json');
        yield* Effect.all(
          Array.from({ length: 20 }, () => counters.increment('a', 0, 'one')),
          { concurrency: 'unbounded' },
        );
        assert.strictEqual(counters.initial('a', 0, 'one'), 20);
        yield* counters.increment('b', 100);
        const restored = yield* Counters.make('counter.json');
        assert.strictEqual(restored.initial('a', 0, 'one'), 20);
        assert.strictEqual(restored.initial('b', 100), 101);
        assert.strictEqual(restored.initial('a', 0, 'two'), 0);
        assert.strictEqual(yield* restored.increment('a', 0, 'two'), 1);
      }),
    ).pipe(Effect.provide(persistence)),
);

it.effect(
  'an integration observer reports disable and recovery independently of the polling clock',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const control = yield* make();
        const service = yield* State.make<number, IntegrationError>(
          new IntegrationError({ message: 'Offline' }),
          'obs',
        ).pipe(Effect.provideService(IntegrationControl, control));
        yield* service.publish(Result.succeed(7));
        const offline = yield* service.observe.pipe(
          Stream.filter(Result.isFailure),
          Stream.runHead,
          Effect.forkScoped,
        );
        yield* control.set('obs', false);
        assert.ok(Option.isSome(yield* Fiber.join(offline)));
        const online = yield* service.observe.pipe(
          Stream.filter(Result.isSuccess),
          Stream.runHead,
          Effect.forkScoped,
        );
        yield* control.set('obs', true);
        assert.ok(Option.isSome(yield* Fiber.join(online)));
      }),
    ).pipe(Effect.provide(persistence)),
);
