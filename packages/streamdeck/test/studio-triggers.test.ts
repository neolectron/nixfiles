import { assert, it } from '@effect/vitest';
import { NodeHttpServer, NodeServices } from '@effect/platform-node';
import { Deferred, Effect, Fiber, FileSystem, Layer, Ref, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { HttpClient, HttpClientRequest, HttpServer } from 'effect/http';
import * as Mock from '../src/mock.ts';
import * as Actions from '../src/studio-actions.tsx';
import * as Audio from '@nixfiles/system-control/audio.ts';
import * as Talk from '../src/plugins/push-to-talk.ts';
import { ButtonBinding } from '../src/studio-contract.ts';
import { StreamDeck } from '../src/stream-deck.ts';
import { httpApp, startStudio } from '../src/scripts/studio.ts';
const counter = (type: 'press' | 'long-press' | 'double-tap') => ({
  label: type,
  action: 'counter' as const,
  parameters: { start: 0 },
  ...(type === 'press' ? {} : { trigger: { type, milliseconds: 100 } }),
});

it.effect(
  'physical key events recognize gestures, keep legacy immediate bindings and persist trigger configuration',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-triggers-' });
        const mock = Mock.make();
        const profile = `${directory}/profile.json`;
        yield* Effect.gen(function* () {
          const studio = yield* startStudio({
            profile,
            applications: [],
            mock: true,
            configurePlugins: () => Effect.void,
          });
          yield* studio.actions.save(0, counter('long-press'));
          yield* studio.actions.save(1, counter('double-tap'));
          yield* studio.actions.save(2, counter('press'));
          const router = yield* Effect.forkScoped(studio.run);
          yield* mock.emit({ _tag: 'KeyDown', key: 0 });
          yield* TestClock.adjust(50);
          yield* mock.emit({ _tag: 'KeyUp', key: 0 });
          yield* TestClock.adjust(100);
          assert.strictEqual((yield* studio.snapshot).keys[0]!.count, 0);
          yield* mock.emit({ _tag: 'KeyDown', key: 0 });
          yield* TestClock.adjust(100);
          assert.strictEqual((yield* studio.snapshot).keys[0]!.count, 1);
          yield* TestClock.adjust(1000);
          yield* mock.emit({ _tag: 'KeyUp', key: 0 });
          yield* TestClock.adjust(0);
          assert.strictEqual((yield* studio.snapshot).keys[0]!.count, 1);
          const tap = (key: number) =>
            mock
              .emit({ _tag: 'KeyDown', key })
              .pipe(
                Effect.andThen(mock.emit({ _tag: 'KeyUp', key })),
                Effect.andThen(TestClock.adjust(0)),
              );
          yield* tap(1);
          assert.strictEqual((yield* studio.snapshot).keys[1]!.count, 0);
          yield* TestClock.adjust(50);
          yield* tap(1);
          assert.strictEqual((yield* studio.snapshot).keys[1]!.count, 1);
          yield* tap(2);
          assert.strictEqual((yield* studio.snapshot).keys[2]!.count, 1);
          yield* Fiber.interrupt(router);
          const saved = JSON.parse(yield* fs.readFileString(profile));
          assert.strictEqual(saved.zones[0].items[0].binding.trigger.type, 'long-press');
          const restored = yield* Actions.make(yield* StreamDeck, profile, []);
          assert.deepStrictEqual((yield* restored.view).keys.get(1)!.entry!.binding.trigger, {
            type: 'double-tap',
            milliseconds: 100,
          });
        }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(mock.layer(), Audio.demoLayer)));
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect(
  'page navigation, edits, stale web cleanup and source changes cannot trigger a different action',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-trigger-pages-' });
        const mock = Mock.make();
        yield* Effect.gen(function* () {
          const actions = yield* Actions.make(yield* StreamDeck, `${directory}/profile.json`, []);
          yield* actions.save(0, counter('long-press'));
          yield* actions.keyInput(0, 'down');
          yield* actions.organize({
            operation: 'add-page',
            zone: 'deck',
            revision: (yield* actions.view).layout.revision,
          });
          yield* actions.navigate({ zone: 'deck', operation: 'previous' });
          yield* TestClock.adjust(100);
          assert.strictEqual((yield* actions.states).get(0)!.count, 0);
          yield* actions.keyInput(0, 'up');
          yield* actions.keyInput(0, 'down');
          yield* actions.save(0, counter('double-tap'));
          yield* TestClock.adjust(100);
          assert.strictEqual((yield* actions.states).get(0)!.count, 0);
          yield* actions.keyInput(0, 'up');
          const physicalTap = actions
            .keyInput(0, 'down')
            .pipe(Effect.andThen(actions.keyInput(0, 'up')));
          yield* physicalTap;
          const old = yield* actions.view;
          const address = old.keys.get(0)!.address;
          yield* actions.keyInput(0, 'down', address, 'web', old.layout.revision);
          yield* actions.keyInput(0, 'up', address, 'web', old.layout.revision);
          assert.strictEqual((yield* actions.states).get(0)!.count, 0);
          yield* actions.save(0, counter('double-tap'));
          const fresh = yield* actions.view;
          yield* actions.keyInput(0, 'down', address, 'web', fresh.layout.revision);
          yield* actions.keyInput(0, 'up', address, 'web', fresh.layout.revision);
          yield* actions.keyInput(0, 'cancel', address, 'web', old.layout.revision);
          yield* actions.keyInput(0, 'down', address, 'web', fresh.layout.revision);
          yield* actions.keyInput(0, 'up', address, 'web', fresh.layout.revision);
          assert.strictEqual((yield* actions.states).get(0)!.count, 1);
          assert.strictEqual(
            (yield* Effect.result(actions.keyInput(0, 'down', address, 'web', old.layout.revision)))
              ._tag,
            'Failure',
          );
        }).pipe(Effect.scoped, Effect.provide(mock.layer()));
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect(
  'long-press push-to-talk waits for its threshold, rejects double tap and releases the physical owner after paging',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-trigger-talk-' });
        const mock = Mock.make();
        const starts = yield* Ref.make(0);
        const stops = yield* Ref.make(0);
        const entered = yield* Deferred.make<void>();
        const stopped = yield* Deferred.make<void>();
        const target = Layer.succeed(Talk.VoiceTarget, {
          start: Ref.update(starts, (n) => n + 1).pipe(
            Effect.andThen(Deferred.succeed(entered, undefined)),
          ),
          stop: Ref.update(stops, (n) => n + 1).pipe(
            Effect.andThen(Deferred.succeed(stopped, undefined)),
          ),
        });
        yield* Effect.gen(function* () {
          const studio = yield* startStudio({
            profile: `${directory}/profile.json`,
            applications: [],
            mock: true,
            configurePlugins: (host) => host.install(Talk.plugin(target)),
          });
          yield* studio.setPlugin({ id: 'dot-voice', enabled: true, expected: false });
          const binding = {
            label: 'Talk',
            action: 'plugin',
            parameters: { plugin: 'dot-voice', command: 'talk', input: {} },
            trigger: { type: 'long-press', milliseconds: 100 },
          };
          yield* studio.actions.save(0, binding);
          const before = yield* studio.snapshot;
          yield* studio.actions.keyInput(0, 'down');
          yield* TestClock.adjust(99);
          assert.strictEqual(yield* Ref.get(starts), 0);
          yield* TestClock.adjust(1);
          yield* Deferred.await(entered);
          assert.strictEqual(yield* Ref.get(starts), 1);
          // A browser inspector losing focus must not release a physically held microphone.
          yield* studio.actions.keyInput(
            0,
            'cancel',
            before.keys[0]!.address,
            'web',
            before.layout.revision,
          );
          assert.strictEqual(yield* Ref.get(stops), 0);
          yield* studio.actions.organize({
            operation: 'add-page',
            zone: 'deck',
            revision: before.layout.revision,
          });
          yield* studio.actions.keyInput(0, 'up');
          yield* Deferred.await(stopped);
          assert.strictEqual(yield* Ref.get(stops), 1);
          yield* studio.actions.navigate({ zone: 'deck', operation: 'previous' });
          assert.strictEqual(
            (yield* Effect.result(
              studio.actions.save(0, {
                ...binding,
                trigger: { type: 'double-tap', milliseconds: 350 },
              }),
            ))._tag,
            'Failure',
          );
          yield* studio.actions.keyInput(0, 'down');
          yield* studio.setPlugin({ id: 'shortcuts', enabled: false, expected: true });
          yield* TestClock.adjust(1000);
          assert.strictEqual(yield* Ref.get(starts), 1);
        }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(mock.layer(), Audio.demoLayer)));
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.live(
  'the gesture HTTP endpoint rejects foreign origins and invalid thresholds; web double-tap dispatches once',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-trigger-http-' });
        const mock = Mock.make();
        yield* Effect.gen(function* () {
          const studio = yield* startStudio({
            profile: `${directory}/profile.json`,
            applications: [],
            mock: true,
            configurePlugins: () => Effect.void,
          });
          yield* studio.actions.save(0, {
            ...counter('double-tap'),
            trigger: { type: 'double-tap', milliseconds: 1000 },
          });
          const server = yield* HttpServer.HttpServer;
          if (server.address._tag === 'UnixPathAddress') throw new Error('Expected TCP server');
          const base = `http://127.0.0.1:${server.address.port}`;
          yield* server.serve(yield* httpApp(studio, [base]));
          const client = yield* HttpClient.HttpClient;
          const view = yield* studio.snapshot;
          const body = {
            key: 0,
            phase: 'down',
            address: view.keys[0]!.address,
            revision: view.layout.revision,
          };
          const post = (phase: 'down' | 'up' | 'cancel', origin = base) =>
            client.execute(
              HttpClientRequest.post('/api/key-input').pipe(
                HttpClientRequest.setHeader('origin', origin),
                HttpClientRequest.setHeader('x-streamdeck-studio', '1'),
                HttpClientRequest.bodyJsonUnsafe({ ...body, phase }),
              ),
            );
          assert.strictEqual((yield* post('down', 'https://foreign.example')).status, 403);
          for (const phase of ['down', 'up', 'down', 'up'] as const)
            assert.strictEqual((yield* post(phase)).status, 200);
          assert.strictEqual((yield* studio.snapshot).keys[0]!.count, 1);
          assert.strictEqual(
            (yield* Effect.result(
              Schema.decodeUnknownEffect(ButtonBinding)({
                ...counter('double-tap'),
                trigger: { type: 'double-tap', milliseconds: 10000 },
              }),
            ))._tag,
            'Failure',
          );
        }).pipe(
          Effect.scoped,
          Effect.provide(Layer.mergeAll(mock.layer(), Audio.demoLayer, NodeHttpServer.layerTest)),
        );
      }),
    ).pipe(Effect.provide(NodeServices.layer), Effect.timeout('5 seconds')),
);
