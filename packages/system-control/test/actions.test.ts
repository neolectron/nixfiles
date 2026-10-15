import { assert, it } from '@effect/vitest';
import { Context, Deferred, Effect, Fiber, Layer, Ref, Result, Schema } from 'effect';
import { PersistentState } from '../src/persistent-state.ts';
import { StateStorage } from '../src/state-storage.ts';
import * as Integration from '../src/integration-control.ts';
import { define, make } from '../src/actions.ts';
import { install } from '../src/system-actions.ts';
import { demoLayer } from '../src/audio.ts';
import { make as makeRegistry } from '../src/mpris-registry.ts';
import { spotify as fixture } from './spotify-fixture.ts';

class Dependency extends Context.Service<Dependency, { add: (n: number) => number }>()(
  'test/Dependency',
) {}

it.effect(
  'typed actions share scoped dependencies, validate output, discover choices and retain no arguments in diagnostics',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const actions = yield* make;
        const add = define({
          id: 'test.add',
          name: 'Add',
          input: Schema.Struct({ n: Schema.Int }),
          output: Schema.Int,
          choices: { n: Effect.succeed([{ value: '1', label: 'One' }]) },
          run: ({ n }) => Effect.map(Dependency, (api) => api.add(n)),
        });
        yield* actions.register(add).pipe(Effect.provideService(Dependency, { add: (n) => n + 1 }));
        assert.strictEqual(yield* actions.invoke('test.add', { n: 2 }), 3);
        assert.ok(
          Result.isFailure(yield* Effect.result(actions.invoke('test.add', { n: 'secret' }))),
        );
        assert.deepStrictEqual(yield* actions.choices('test.add', 'n'), [
          { value: '1', label: 'One' },
        ]);
        assert.notInclude(JSON.stringify(yield* actions.diagnostics), 'secret');
        yield* actions.register(
          define({
            id: 'invalid',
            name: 'Bad',
            input: Schema.Unknown,
            output: Schema.Int,
            run: () => Effect.succeed(NaN),
          }),
        );
        const invalid = yield* Effect.result(actions.invoke('invalid', {}));
        assert.ok(Result.isFailure(invalid));
        if (Result.isFailure(invalid)) assert.strictEqual(invalid.failure.code, 'InvalidOutput');
      }),
    ),
);

it.effect('system catalogue exposes typed read/write operations through an injected backend', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const actions = yield* make;
      yield* install(actions);
      assert.ok((yield* actions.catalogue).some((entry) => entry.id === 'obs.start-record'));
      assert.ok((yield* actions.catalogue).every((entry) => entry.output && entry.error));
      assert.ok(!(yield* actions.capability('obs.start-record')).available);
      yield* actions.invoke('audio.master.volume', { value: 120 });
      const state = yield* actions.invoke('audio.state', {});
      assert.closeTo((state as { master: { volume: number } }).master.volume, 120, 0.001);
    }).pipe(Effect.provide(demoLayer)),
  ),
);

it.effect('the MPRIS registry shares a controller and one lifecycle for the same bus', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const transport = yield* fixture;
      yield* Effect.gen(function* () {
        const registry = yield* makeRegistry;
        const a = yield* registry.player('org.mpris.MediaPlayer2.spotify', 'Spotify');
        const b = yield* registry.player('org.mpris.MediaPlayer2.spotify', 'Different consumer');
        assert.strictEqual(a, b);
        assert.strictEqual(yield* registry.count, 1);
      }).pipe(Effect.provide(transport.layer));
    }),
  ),
);

it.effect(
  'in-flight catalogue actions are cancelled and cleaned when their integration is disabled',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const control = yield* Integration.make();
        const actions = yield* make.pipe(
          Effect.provideService(Integration.IntegrationControl, control),
        );
        const started = yield* Deferred.make<void>();
        const cleaned = yield* Ref.make(false);
        yield* actions.register(
          define({
            id: 'obs.wait',
            name: 'Wait',
            input: Schema.Unknown,
            output: Schema.Unknown,
            run: () =>
              Effect.acquireUseRelease(
                Deferred.succeed(started, undefined),
                () => Effect.never,
                () => Ref.set(cleaned, true),
              ),
          }),
        );
        const pending = yield* actions.invoke('obs.wait', {}).pipe(Effect.forkScoped);
        yield* Deferred.await(started);
        yield* control.set('obs', false);
        assert.ok(Result.isFailure(yield* Effect.result(Fiber.join(pending))));
        assert.strictEqual(yield* Ref.get(cleaned), true);
        assert.strictEqual((yield* actions.diagnostics)[0]?.code, 'Unavailable');
        assert.strictEqual((yield* actions.capability('obs.wait')).available, false);
      }),
    ).pipe(Effect.provide(PersistentState.layer.pipe(Layer.provide(StateStorage.layerMemory)))),
);
