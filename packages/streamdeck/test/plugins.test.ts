import { assert, it } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import {
  Config,
  Context,
  Deferred,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Ref,
  Schedule,
  Stream,
} from 'effect';
import * as Plugin from '../src/plugin.ts';
import * as Host from '../src/plugin-host.ts';
import * as Sources from '../src/sources.ts';
import * as Mock from '../src/mock.ts';
import * as Audio from '../src/audio.ts';
import { StreamDeck } from '../src/stream-deck.ts';
import * as EventDisplay from '../src/plugins/event-display.tsx';
import { startStudio } from '../src/scripts/studio.ts';

it.live(
  'each activation owns its Layer resources and revokes old display writers without reopening USB',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const mock = Mock.make();
        let acquired = 0;
        let released = 0;
        yield* Effect.gen(function* () {
          const host = yield* Host.make;
          class Resource extends Context.Service<Resource, number>()('test/Resource') {}
          const resourceLayer = Layer.effect(
            Resource,
            Effect.acquireRelease(
              Effect.sync(() => acquired++),
              () => Effect.sync(() => released++),
            ),
          );
          const plugin = Plugin.define({
            id: 'counter',
            name: 'Counter',
            description: 'Test',
            controls: { keys: [0] },
            setup: Effect.gen(function* () {
              yield* Layer.build(resourceLayer);
              const deck = yield* StreamDeck;
              yield* deck.key(0).label('ACTIVE');
              return { api: deck.key(0), run: Effect.never };
            }),
          });
          const handle = yield* host.install(plugin);
          assert.strictEqual(acquired, 0);
          yield* host.setEnabled('counter', true);
          const old = Option.getOrThrow(yield* handle.current);
          yield* host.setEnabled('counter', false);
          assert.strictEqual(released, 1);
          assert.strictEqual(
            (yield* Effect.result(handle.use((key) => key.label('NO'))))._tag,
            'Failure',
          );
          yield* host.setEnabled('counter', true);
          assert.strictEqual(acquired, 2);
          const writes = mock.writes.length;
          assert.strictEqual((yield* Effect.result(old.label('STALE')))._tag, 'Failure');
          assert.strictEqual(mock.writes.length, writes);
          yield* host.setEnabled('counter', true);
          assert.strictEqual(acquired, 2);
        }).pipe(Effect.scoped, Effect.provide(mock.layer()));
        assert.strictEqual(released, 2);
        assert.strictEqual(mock.opens, 1);
        assert.strictEqual(mock.closes, 1);
      }),
    ),
);

it.live(
  'control conflicts reject activation and a failed source releases resources for another plugin',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const mock = Mock.make();
        let closed = 0;
        yield* Effect.gen(function* () {
          const host = yield* Host.make;
          const fail = yield* Deferred.make<never, string>();
          const first = Plugin.define({
            id: 'first',
            name: 'First',
            description: '',
            controls: { keys: [0] },
            setup: Effect.gen(function* () {
              yield* Effect.addFinalizer(() => Effect.sync(() => closed++));
              return { api: {}, run: Deferred.await(fail) };
            }),
          });
          const second = Plugin.define({
            id: 'second',
            name: 'Second',
            description: '',
            controls: { keys: [0] },
            setup: Effect.succeed({ api: {} }),
          });
          yield* host.install(first);
          yield* host.install(second);
          yield* host.setEnabled('first', true);
          assert.strictEqual(
            (yield* Effect.result(host.setEnabled('second', true)))._tag,
            'Failure',
          );
          yield* Deferred.fail(fail, 'source unavailable');
          const state = yield* Effect.repeat(host.snapshot, {
            until: (view) => view.items[0]!.phase === 'error',
            schedule: Schedule.spaced(1),
          });
          assert.strictEqual(closed, 1);
          assert.ok(state.items[0]!.detail.includes('source unavailable'));
          yield* host.setEnabled('second', true);
          assert.strictEqual((yield* host.snapshot).items[1]!.enabled, true);
        }).pipe(Effect.scoped, Effect.provide(mock.layer()));
      }),
    ).pipe(Effect.timeout('5 seconds')),
);

it.live('callback sources unsubscribe and plugin-scoped actions are cancelled on disable', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const mock = Mock.make();
      let emit: ((value: number) => boolean) | undefined;
      let unsubscribed = 0;
      yield* Effect.gen(function* () {
        const host = yield* Host.make;
        const seen = yield* Deferred.make<void>();
        const plugin = Plugin.define({
          id: 'source',
          name: 'Source',
          description: '',
          controls: {},
          setup: Effect.gen(function* () {
            const total = yield* Ref.make(0);
            const source = Sources.callback<number>((push) => {
              emit = push;
              return () => {
                emit = undefined;
                unsubscribed++;
              };
            });
            return {
              api: { total: Ref.get(total) },
              run: Plugin.listen(source, (value) =>
                Ref.update(total, (n) => n + value).pipe(
                  Effect.andThen(Deferred.succeed(seen, undefined)),
                ),
              ),
            };
          }),
        });
        const handle = yield* host.install(plugin);
        yield* host.setEnabled('source', true);
        yield* Effect.repeat(
          Effect.sync(() => !!emit),
          { until: Boolean, schedule: Schedule.spaced(1) },
        );
        emit!(7);
        yield* Deferred.await(seen);
        assert.strictEqual(yield* handle.use((api) => api.total), 7);
        const started = yield* Deferred.make<void>();
        const finalized = yield* Deferred.make<void>();
        const action = yield* Effect.forkScoped(
          handle.use(() =>
            Effect.gen(function* () {
              yield* Effect.addFinalizer(() => Deferred.succeed(finalized, undefined));
              yield* Deferred.succeed(started, undefined);
              yield* Effect.never;
            }),
          ),
        );
        yield* Deferred.await(started);
        yield* host.setEnabled('source', false);
        yield* Deferred.await(finalized);
        assert.strictEqual(unsubscribed, 1);
        assert.strictEqual(Option.isNone(yield* handle.current), true);
        assert.strictEqual((yield* Fiber.await(action))._tag, 'Failure');
      }).pipe(Effect.scoped, Effect.provide(mock.layer()));
    }),
  ).pipe(Effect.timeout('5 seconds')),
);

it.live(
  'mixer and shortcuts toggle independently, persist preferences and stop audio input without closing the deck',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-plugins-' });
        const profile = `${directory}/profile.json`;
        const mock = Mock.make();
        let commands = 0;
        const audio = Audio.Audio.of({
          list: Effect.succeed([]),
          master: Effect.succeed({
            name: 'test',
            serial: '1',
            channels: [65536],
            volume: 100,
            muted: false,
          }),
          change: () =>
            Effect.sync(() => {
              commands++;
            }),
          changeMaster: () =>
            Effect.sync(() => {
              commands++;
            }),
        });
        yield* Effect.gen(function* () {
          const studio = yield* startStudio({ profile, applications: [], mock: true });
          yield* studio.actions.save(0, {
            label: 'Count',
            action: 'counter',
            parameters: { start: 5 },
          });
          yield* studio.setPlugin({ id: 'audio-mixer', enabled: false, expected: true });
          assert.strictEqual((yield* studio.snapshot).dials.at(-1)!.volume, null);
          yield* mock.emit({ _tag: 'DialRotate', dial: 5, delta: 1 });
          yield* Effect.sleep(60);
          assert.strictEqual(commands, 0);
          yield* studio.actions.press(0);
          assert.strictEqual((yield* studio.snapshot).keys[0]!.count, 6);
          yield* studio.setPlugin({ id: 'audio-mixer', enabled: true, expected: false });
          assert.strictEqual((yield* studio.snapshot).dials.at(-1)!.volume, 100);
          yield* studio.setPlugin({ id: 'shortcuts', enabled: false, expected: true });
          assert.strictEqual((yield* Effect.result(studio.actions.press(0)))._tag, 'Failure');
          yield* studio.setPlugin({ id: 'shortcuts', enabled: true, expected: false });
          assert.strictEqual((yield* studio.snapshot).keys[0]!.count, 5);
          yield* studio.setPlugin({ id: 'audio-mixer', enabled: false, expected: true });
          assert.strictEqual(
            JSON.parse(yield* fs.readFileString(`${profile}.plugins.json`)).enabled['audio-mixer'],
            false,
          );
          assert.strictEqual(mock.opens, 1);
        }).pipe(
          Effect.scoped,
          Effect.provide(Layer.mergeAll(mock.layer(), Layer.succeed(Audio.Audio, audio))),
        );
        const reloaded = Mock.make();
        yield* Effect.gen(function* () {
          const studio = yield* startStudio({ profile, applications: [], mock: true });
          assert.strictEqual(
            (yield* studio.snapshot).plugins.items.find((plugin) => plugin.id === 'audio-mixer')!
              .enabled,
            false,
          );
          assert.strictEqual((yield* studio.snapshot).keys[0]!.binding!.label, 'Count');
        }).pipe(
          Effect.scoped,
          Effect.provide(Layer.mergeAll(reloaded.layer(), Layer.succeed(Audio.Audio, audio))),
        );
      }),
    ).pipe(Effect.provide(NodeServices.layer), Effect.timeout('10 seconds')),
);

it.live(
  'callback overflow fails visibly and setup failures clean up without taking another plugin down',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        let stopped = 0;
        const source = Sources.callback<number>(
          (emit) => {
            emit(1);
            emit(2);
            return () => {
              stopped++;
            };
          },
          { capacity: 1 },
        );
        assert.strictEqual((yield* Effect.result(Stream.runCollect(source)))._tag, 'Failure');
        assert.strictEqual(stopped, 1);
        const mock = Mock.make();
        yield* Effect.gen(function* () {
          const host = yield* Host.make;
          let released = 0;
          const broken = Plugin.define({
            id: 'broken',
            name: 'Broken',
            description: '',
            controls: { keys: [0] },
            setup: Effect.gen(function* () {
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  released++;
                }),
              );
              return yield* Effect.fail('setup failed');
            }),
          });
          const other = Plugin.define({
            id: 'other',
            name: 'Other',
            description: '',
            controls: { keys: [1] },
            setup: Effect.succeed({ api: undefined }),
          });
          yield* host.install(broken);
          const handle = yield* host.install(other);
          yield* host.setEnabled('other', true);
          assert.strictEqual(
            (yield* Effect.result(host.setEnabled('broken', true)))._tag,
            'Failure',
          );
          assert.strictEqual(released, 1);
          assert.strictEqual((yield* host.snapshot).items[1]!.enabled, true);
          assert.strictEqual(yield* handle.use(() => Effect.succeed(42)), 42);
          const forbidden = yield* Effect.result(
            handle.use(() => Effect.flatMap(StreamDeck, (deck) => deck.key(0).label('Not owned'))),
          );
          assert.strictEqual(forbidden._tag, 'Failure');
        }).pipe(Effect.scoped, Effect.provide(mock.layer()));
      }),
    ),
);

it.live('a plugin can disable itself without waiting on its own scope', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const mock = Mock.make();
      yield* Effect.gen(function* () {
        const host = yield* Host.make;
        const handle = yield* host.install(
          Plugin.define({
            id: 'self-stop',
            name: 'Self stop',
            description: '',
            controls: {},
            setup: Effect.succeed({ api: {} }),
          }),
        );
        yield* host.setEnabled(handle.id, true);
        const action = yield* Effect.forkScoped(
          handle.use(() => host.setEnabled(handle.id, false)),
        );
        yield* Fiber.await(action);
        yield* Effect.repeat(host.snapshot, {
          until: (view) => view.items[0]!.phase === 'disabled',
          schedule: Schedule.spaced(1),
        });
        yield* host.setEnabled(handle.id, true);
        assert.strictEqual((yield* host.snapshot).items[0]!.enabled, true);
      }).pipe(Effect.scoped, Effect.provide(mock.layer()));
    }),
  ).pipe(Effect.timeout('5 seconds')),
);

it.live(
  'the same React plugin consumes external streams and physical inputs with mirrored key feedback',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const mock = Mock.make();
        yield* Effect.gen(function* () {
          const host = yield* Host.make;
          const handle = yield* host.install(EventDisplay.plugin(Stream.succeed('Hello source')));
          yield* host.setEnabled(handle.id, true);
          const state = handle.use((api) => api.state);
          yield* Effect.repeat(state, {
            until: (view) => view.message === 'Hello source',
            schedule: Schedule.spaced(1),
          });
          yield* mock.emit({ _tag: 'KeyDown', key: 0 });
          const pressed = yield* Effect.repeat(state, {
            until: (view) => view.presses === 1,
            schedule: Schedule.spaced(1),
          });
          assert.strictEqual(pressed.message, 'Hello source');
          yield* mock.emit({ _tag: 'KeyDown', key: 1 });
          assert.strictEqual((yield* state).presses, 1);
          assert.ok(
            mock.writes.filter((write) => write.kind === 'key' && write.index === 0).length >= 2,
          );
          yield* host.setEnabled(handle.id, false);
          const last = mock.writes.at(-1)!;
          assert.strictEqual(last.kind, 'key');
          assert.ok('image' in last && last.image.data.every((channel) => channel === 0));
        }).pipe(Effect.scoped, Effect.provide(mock.layer()));
      }),
    ).pipe(Effect.timeout('5 seconds')),
);

it.live('disabling shortcuts terminates only their scoped command processes', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const node = yield* Config.String('npm_node_execpath');
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-plugin-command-' });
      const mock = Mock.make();
      yield* Effect.gen(function* () {
        const studio = yield* startStudio({
          profile: `${directory}/profile.json`,
          applications: [],
          mock: true,
        });
        yield* studio.actions.save(0, {
          label: 'Child',
          action: 'run-command',
          parameters: {
            executable: node,
            arguments: ['-e', 'console.log(process.pid); setInterval(() => {}, 10000)'],
            directory: '',
          },
        });
        yield* studio.actions.press(0);
        const started = yield* Effect.repeat(studio.snapshot, {
          until: (view) => !!view.keys[0]!.detail.trim(),
          schedule: Schedule.spaced(1),
        });
        const pid = Number(started.keys[0]!.detail.trim());
        assert.ok(yield* fs.exists(`/proc/${pid}`));
        yield* studio.setPlugin({ id: 'shortcuts', enabled: false, expected: true });
        assert.strictEqual(yield* fs.exists(`/proc/${pid}`), false);
        assert.strictEqual(
          (yield* studio.snapshot).plugins.items.find((plugin) => plugin.id === 'audio-mixer')!
            .enabled,
          true,
        );
      }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(mock.layer(), Audio.demoLayer)));
    }),
  ).pipe(Effect.provide(NodeServices.layer), Effect.timeout('5 seconds')),
);
