import { assert, it } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import { Context, Effect, FileSystem, Layer, Option, Schema, Schedule } from 'effect';
import { PersistentState } from '@nixfiles/system-control/persistent-state.ts';
import { StateStorage } from '@nixfiles/system-control/state-storage.ts';
import { demoLayer } from '@nixfiles/system-control/audio.ts';
import * as Mock from '../src/mock.ts';
import * as Plugin from '../src/plugin.ts';
import * as Settings from '../src/plugin-settings.ts';
import { startStudio } from '../src/scripts/studio.ts';

const counter = Plugin.define({
  id: 'stateful',
  name: 'Stateful',
  description: '',
  controls: {},
  setup: Effect.gen(function* () {
    const document = (yield* PersistentState).document(
      'plugins/stateful/count.v1.json',
      Schema.Int,
    );
    return {
      api: {
        increment: document.modify((before) =>
          Effect.succeed(Option.getOrElse(before, () => 0) + 1),
        ),
      },
    };
  }),
  actions: [
    Plugin.action({
      id: 'increment',
      name: 'Increment',
      description: '',
      input: Plugin.NoInput,
      defaults: {},
      run: (api: { increment: Effect.Effect<number, unknown> }) => api.increment,
    }),
  ],
});

it.live(
  'one injected adapter persists layout, preferences, notes and plugin state without touching legacy files',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-state-' });
        const profile = `${root}/profile.json`;
        const sentinel =
          'This legacy file must not be read or written with an injected memory adapter.';
        yield* fs.writeFileString(profile, sentinel);
        const backend = Context.get(yield* Layer.build(StateStorage.layerMemory), StateStorage);
        const options = {
          profile,
          mock: true,
          applications: [],
          persistence: Layer.succeed(StateStorage, backend),
          configurePlugins: (
            host: Parameters<NonNullable<Parameters<typeof startStudio>[0]['configurePlugins']>>[0],
          ) => host.install(counter),
        };
        // Each application scope is fresh; only the selected backend survives the restart.
        yield* Effect.scoped(
          Effect.gen(function* () {
            const app = yield* startStudio(options);
            yield* app.actions.save(0, {
              label: 'Saved',
              action: 'counter',
              parameters: { start: 42 },
            });
            yield* app.actions.save(1, {
              label: 'Stateful',
              action: 'plugin',
              parameters: { plugin: 'stateful', command: 'increment', input: {} },
            });
            yield* app.setPlugin({ id: 'stateful', enabled: true, expected: false });
            yield* app.actions.press(1);
            yield* Effect.repeat(app.snapshot, {
              until: (view) => view.keys[1]?.status === 'success',
              schedule: Schedule.spaced(1),
            });
            yield* app.notes.ensure('idea', 'Idée');
            yield* app.notes.append('idea', 'Persisted note');
            yield* app.setPlugin({ id: 'commands', enabled: false, expected: true });
          }).pipe(Effect.provide(Layer.mergeAll(Mock.make().layer(), demoLayer))),
        );
        yield* Effect.scoped(
          Effect.gen(function* () {
            const app = yield* startStudio(options);
            const snapshot = yield* app.snapshot;
            assert.strictEqual(snapshot.keys[0]?.binding?.label, 'Saved');
            assert.strictEqual(snapshot.keys[0]?.count, 42);
            assert.strictEqual(
              snapshot.plugins.items.find((p) => p.id === 'commands')?.enabled,
              false,
            );
            assert.strictEqual(
              snapshot.plugins.items.find((p) => p.id === 'stateful')?.enabled,
              true,
            );
            assert.strictEqual((yield* app.notes.read('idea')).body, 'Persisted note');
            assert.strictEqual(
              Option.getOrThrow(
                yield* app.persistentState.document('plugins/stateful/count.v1.json', Schema.Int)
                  .get,
              ),
              1,
            );
          }).pipe(Effect.provide(Layer.mergeAll(Mock.make().layer(), demoLayer))),
        );
        yield* Effect.scoped(
          Effect.gen(function* () {
            const app = yield* startStudio({
              ...options,
              persistence: Layer.fresh(StateStorage.layerMemory),
            });
            assert.strictEqual((yield* app.snapshot).keys[0]?.binding, null);
            assert.strictEqual((yield* app.notes.read('idea')).revision, 0);
          }).pipe(Effect.provide(Layer.mergeAll(Mock.make().layer(), demoLayer))),
        );
        assert.strictEqual(yield* fs.readFileString(profile), sentinel);
        assert.deepStrictEqual(yield* fs.readDirectory(root), ['profile.json']);
      }),
    ).pipe(Effect.provide(NodeServices.layer), Effect.timeout('10 seconds')),
);

it.effect('concurrent preference writers preserve other plugins and unknown settings', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const one = yield* Settings.makeWithState('profile.plugins.json');
      const two = yield* Settings.makeWithState('profile.plugins.json');
      yield* Effect.all([one.save('a', true), two.save('b', false)], { concurrency: 'unbounded' });
      assert.deepStrictEqual((yield* Settings.makeWithState('profile.plugins.json')).initial, {
        a: true,
        b: false,
      });
    }).pipe(Effect.provide(PersistentState.layer.pipe(Layer.provide(StateStorage.layerMemory)))),
  ),
);
