import { assert, it } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import { Context, Effect, FileSystem, Layer, Option, Result, Schema, Schedule } from 'effect';
import { KeyValueStoreError } from 'effect/persistence/KeyValueStore';
import { PersistentState } from '@nixfiles/system-control/persistent-state.ts';
import { StateStorage } from '@nixfiles/system-control/state-storage.ts';
import { demoLayer } from '@nixfiles/system-control/audio.ts';
import * as Mock from '../src/mock.ts';
import * as Plugin from '../src/plugin.ts';
import * as Settings from '../src/plugin-settings.ts';
import { startStudio } from '../src/scripts/studio.ts';
import * as Actions from '../src/studio-actions.tsx';
import * as Layout from '../src/studio-layout.ts';
import { StreamDeck } from '../src/stream-deck.ts';

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
            yield* app.actions.press(0);
            yield* app.actions.press(0);
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
            assert.strictEqual(snapshot.keys[0]?.count, 44);
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

it.live(
  'file-backed counters survive restart, movement and label edits; changing start resets only that counter',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-counter-' });
        const file = `${directory}/profile.json`;
        const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          Effect.scoped(effect.pipe(Effect.provide(Mock.make().layer())));
        yield* run(
          Effect.gen(function* () {
            const actions = yield* Actions.make(yield* StreamDeck, file, []);
            yield* actions.save(8, {
              label: 'Compteur',
              action: 'counter',
              parameters: { start: 4 },
            });
            yield* actions.save(0, {
              label: 'Autre',
              action: 'counter',
              parameters: { start: 100 },
            });
            const before = yield* fs.readFileString(file);
            yield* Effect.all(
              Array.from({ length: 20 }, () => actions.press(8)),
              { concurrency: 'unbounded' },
            );
            assert.strictEqual((yield* actions.states).get(8)?.count, 24);
            assert.strictEqual(yield* fs.readFileString(file), before);
            const view = yield* actions.view;
            const profile = Layout.copy(view.configuration.profile);
            const entry = profile.zones[0]!.items[8]!;
            profile.zones[0]!.items[8] = {
              ...entry,
              binding: { ...entry.binding, label: 'Renommé' },
            };
            yield* actions.saveProfile(profile, {}, view.configuration.revision);
            assert.strictEqual((yield* actions.states).get(8)?.count, 24);
            const moved = yield* actions.view;
            yield* actions.organize({
              operation: 'exchange',
              source: 8,
              target: 7,
              sourceAddress: moved.keys.get(8)!.address,
              targetAddress: moved.keys.get(7)!.address,
              revision: moved.layout.revision,
            });
            assert.strictEqual((yield* actions.states).get(7)?.count, 24);
          }),
        );
        yield* run(
          Effect.gen(function* () {
            const actions = yield* Actions.make(yield* StreamDeck, file, []);
            assert.strictEqual((yield* actions.states).get(7)?.count, 24);
            assert.strictEqual((yield* actions.states).get(0)?.count, 100);
            assert.strictEqual((yield* actions.view).keys.get(7)?.entry?.binding.label, 'Renommé');
            yield* actions.save(7, {
              label: 'Renommé encore',
              action: 'counter',
              parameters: { start: 4 },
            });
            assert.strictEqual((yield* actions.states).get(7)?.count, 24);
            yield* actions.save(7, { label: 'Reset', action: 'counter', parameters: { start: 7 } });
            assert.strictEqual((yield* actions.states).get(7)?.count, 7);
            yield* actions.press(7);
          }),
        );
        yield* run(
          Effect.gen(function* () {
            const actions = yield* Actions.make(yield* StreamDeck, file, []);
            assert.strictEqual((yield* actions.states).get(7)?.count, 8);
            assert.strictEqual((yield* actions.states).get(0)?.count, 100);
            yield* actions.save(7, null);
            yield* actions.save(7, {
              label: 'Nouveau',
              action: 'counter',
              parameters: { start: 0 },
            });
            assert.strictEqual((yield* actions.states).get(7)?.count, 0);
          }),
        );
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.live(
  'a failed counter write reports an error without advancing the display or losing its previous value',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const backend = Context.get(yield* Layer.build(StateStorage.layerMemory), StateStorage);
        let reject = false;
        const adapter = Layer.succeed(StateStorage, {
          ...backend,
          set: (key, value) =>
            reject && key.endsWith('.counters.json')
              ? Effect.fail(new KeyValueStoreError({ method: 'set', key, message: 'Disk full' }))
              : backend.set(key, value),
        });
        yield* Effect.gen(function* () {
          const actions = yield* Actions.makeWithState(
            yield* StreamDeck,
            '/unused/profile.json',
            [],
          );
          yield* actions.save(8, {
            label: 'Compteur',
            action: 'counter',
            parameters: { start: 7 },
          });
          const before = yield* backend.get('profile.json.counters.json');
          reject = true;
          const result = yield* Effect.result(actions.press(8));
          assert.ok(Result.isFailure(result));
          if (Result.isFailure(result)) assert.strictEqual(result.failure._tag, 'StudioError');
          assert.strictEqual((yield* actions.states).get(8)?.count, 7);
          assert.strictEqual((yield* actions.states).get(8)?.status, 'error');
          assert.include((yield* actions.states).get(8)!.detail, 'sauvegarde');
          assert.strictEqual(yield* backend.get('profile.json.counters.json'), before);
          reject = false;
          yield* actions.press(8);
          assert.strictEqual((yield* actions.states).get(8)?.count, 8);
          assert.strictEqual((yield* actions.states).get(8)?.status, 'success');
          assert.strictEqual((yield* actions.states).get(8)?.detail, '');
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              Mock.make().layer(),
              PersistentState.layer.pipe(Layer.provideMerge(adapter)),
            ),
          ),
        );
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);
