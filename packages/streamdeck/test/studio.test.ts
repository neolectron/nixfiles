import { assert, it } from '@effect/vitest';
import { NodeHttpServer, NodeServices } from '@effect/platform-node';
import { Config, Effect, Fiber, FileSystem, Layer, Schedule, Stream } from 'effect';
import { HttpClient, HttpClientRequest, HttpServer } from 'effect/http';
import { decode } from 'fast-png';
import * as Mock from '../src/mock.ts';
import * as Image from '../src/image.ts';
import * as Preview from '../src/deck-preview.ts';
import * as Actions from '../src/studio-actions.tsx';
import { StreamDeck } from '../src/stream-deck.ts';
import { demoLayer } from '@nixfiles/system-control/audio.ts';
import { startStudio, httpApp } from '../src/scripts/studio.ts';

it.live('preview captures exact successful key writes and composes partial LCD frames', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const mock = Mock.make();
      yield* Effect.gen(function* () {
        const deck = yield* StreamDeck;
        const preview = yield* Preview.make(deck);
        const key = yield* Image.solid({ width: 112, height: 112 }, [20, 40, 60]);
        yield* preview.device.key(0).setImage(key);
        key.data.fill(255);
        const region = yield* Image.solid({ width: 4, height: 3 }, [11, 22, 33]);
        yield* preview.device.lcd(0).drawRegion({ x: 10, y: 2 }, region);
        const keyPng = decode(yield* preview.png('key', 0));
        assert.deepStrictEqual([...keyPng.data.subarray(0, 3)], [20, 40, 60]);
        const lcd = decode(yield* preview.png('lcd', 0));
        assert.strictEqual(lcd.width, 1200);
        assert.strictEqual(lcd.height, 100);
        const offset = (2 * 1200 + 10) * 3;
        assert.deepStrictEqual([...lcd.data.subarray(offset, offset + 3)], [11, 22, 33]);
        assert.deepStrictEqual([...lcd.data.subarray(0, 3)], [0, 0, 0]);
      }).pipe(Effect.provide(mock.layer()));
      assert.strictEqual(mock.closes, 1);
    }),
  ),
);

it.live(
  'saved bindings persist without execution; physical and web actions share the counter and preserve mixer',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-actions-' });
        const profile = `${directory}/profile.json`;
        const mock = Mock.make();
        yield* Effect.gen(function* () {
          const studio = yield* startStudio({ profile, mock: true, applications: [] });
          const before = yield* studio.snapshot;
          yield* studio.actions.save(0, {
            label: 'Essai',
            action: 'counter',
            parameters: { start: 4 },
          });
          assert.strictEqual((yield* studio.snapshot).keys[0]!.count, 4);
          const input = yield* Stream.toPull(studio.inputViews);
          const fiber = yield* Effect.forkScoped(studio.run);
          yield* mock.emit({ _tag: 'KeyDown', key: 0 });
          const down = (yield* input)[0];
          assert.strictEqual(down.keys[0]!.pressed, true);
          yield* mock.emit({ _tag: 'KeyUp', key: 0 });
          const up = (yield* input)[0];
          assert.strictEqual(up.keys[0]!.pressed, false);
          assert.strictEqual(up.inputSequence, down.inputSequence + 1);
          yield* mock.emit({ _tag: 'DialDown', dial: 0 });
          const dialDown = (yield* input)[0];
          assert.strictEqual(dialDown.dials[0]!.pressed, true);
          assert.strictEqual(dialDown.keys[0]!.pressed, false);
          yield* mock.emit({ _tag: 'DialUp', dial: 0 });
          const dialUp = (yield* input)[0];
          assert.strictEqual(dialUp.dials[0]!.pressed, false);
          assert.strictEqual(dialUp.inputSequence, dialDown.inputSequence + 1);
          yield* Effect.repeat(studio.snapshot, {
            until: (view) => view.keys[0]!.count === 5,
            schedule: Schedule.spaced(1),
          });
          yield* studio.actions.press(0);
          const after = yield* studio.snapshot;
          assert.strictEqual(after.keys[0]!.count, 6);
          assert.strictEqual(after.dials.at(-1)!.volume, before.dials.at(-1)!.volume);
          const saved = JSON.parse(yield* fs.readFileString(profile));
          assert.strictEqual(saved.zones[0].items[0].binding.parameters.start, 4);
          const invalid = yield* Effect.result(studio.actions.save(99, null));
          assert.strictEqual(invalid._tag, 'Failure');
          yield* Fiber.interrupt(fiber);
        }).pipe(Effect.provide(Layer.mergeAll(mock.layer(), demoLayer)));
        assert.strictEqual(mock.opens, 1);
        assert.strictEqual(mock.closes, 1);
        const second = Mock.make();
        yield* Effect.gen(function* () {
          const restored = yield* Actions.make(yield* StreamDeck, profile, []);
          assert.strictEqual((yield* restored.profile).zones[0]!.items[0]?.binding.label, 'Essai');
          assert.strictEqual((yield* restored.states).get(0)?.count, 6);
        }).pipe(Effect.provide(second.layer()));
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.live(
  'command arguments remain literal, stdout drains and failures are visible without stopping the deck',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const node = yield* Config.String('npm_node_execpath');
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-command-' });
        const mock = Mock.make();
        yield* Effect.gen(function* () {
          const actions = yield* Actions.make(yield* StreamDeck, `${directory}/profile.json`, []);
          const args = ['with spaces', '$(touch never)', '; echo never', '`no execution`'];
          yield* actions.save(1, {
            label: 'Arguments',
            action: 'run-command',
            parameters: {
              executable: node,
              arguments: ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', ...args],
              directory,
            },
          });
          assert.strictEqual((yield* actions.states).get(1)?.detail, '');
          yield* actions.press(1);
          const result = yield* Effect.repeat(actions.states, {
            until: (states) => states.get(1)?.status !== 'running',
            schedule: Schedule.spaced(10),
          });
          assert.strictEqual(result.get(1)?.status, 'success');
          assert.deepStrictEqual(JSON.parse(result.get(1)!.detail), args);
          yield* actions.save(1, {
            label: 'Erreur',
            action: 'run-command',
            parameters: { executable: '/nonexistent/studio-command', arguments: [], directory: '' },
          });
          yield* actions.press(1);
          const failed = yield* Effect.repeat(actions.states, {
            until: (states) => states.get(1)?.status === 'error',
            schedule: Schedule.spaced(10),
          });
          assert.ok(failed.get(1)!.detail.length > 0);
        }).pipe(Effect.provide(mock.layer()), Effect.timeout('5 seconds'));
        assert.strictEqual(mock.closes, 1);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.live(
  'HTTP rejects cross-origin execution and invalid configs, and saves a valid binding through the same controller',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-http-' });
        const mock = Mock.make();
        yield* Effect.gen(function* () {
          const controller = yield* startStudio({
            profile: `${directory}/profile.json`,
            mock: true,
            applications: [],
          });
          const app = yield* httpApp(controller, ['http://127.0.0.1:3901']);
          yield* (yield* HttpServer.HttpServer).serve(app);
          const client = yield* HttpClient.HttpClient;
          const payload = {
            key: 0,
            binding: { label: 'HTTP', action: 'counter', parameters: { start: 8 } },
          };
          const request = (origin: string) =>
            HttpClientRequest.put('/api/binding').pipe(
              HttpClientRequest.bodyJsonUnsafe(payload),
              HttpClientRequest.setHeaders({ origin, 'x-streamdeck-studio': '1' }),
            );
          assert.strictEqual(
            (yield* client.execute(request('https://unrelated.example'))).status,
            403,
          );
          assert.strictEqual(yield* fs.exists(`${directory}/profile.json`), false);
          const connection = HttpClientRequest.put('/api/discord/connection').pipe(
            HttpClientRequest.bodyJsonUnsafe({
              clientId: '123456',
              clientSecret: 'private-test-secret',
            }),
            HttpClientRequest.setHeaders({
              origin: 'http://127.0.0.1:3901',
              'x-streamdeck-studio': '1',
            }),
          );
          assert.strictEqual(
            (yield* client.execute(
              connection.pipe(HttpClientRequest.setHeader('origin', 'https://unrelated.example')),
            )).status,
            403,
          );
          const malformedConnection = yield* client.execute(
            connection.pipe(
              HttpClientRequest.bodyJsonUnsafe({
                clientId: 'invalid',
                clientSecret: 'private-test-secret',
              }),
            ),
          );
          assert.strictEqual(malformedConnection.status, 400);
          assert.ok(!(yield* malformedConnection.text).includes('private-test-secret'));
          const configuredConnection = yield* client.execute(connection);
          assert.strictEqual(configuredConnection.status, 200);
          const publicConnection = yield* configuredConnection.text;
          assert.ok(!publicConnection.includes('private-test-secret'));
          assert.ok(publicConnection.includes('"configured":true'));
          const pendingAuthorization = yield* Effect.result(
            controller.setPlugin({ id: 'discord', enabled: true, expected: false }),
          );
          assert.strictEqual(pendingAuthorization._tag, 'Failure');
          if (pendingAuthorization._tag === 'Failure')
            assert.ok(
              pendingAuthorization.failure.message.includes('Clique Autoriser dans Discord'),
            );
          const unauthorized = HttpClientRequest.post('/api/discord/authorize').pipe(
            HttpClientRequest.setHeaders({
              origin: 'https://unrelated.example',
              'x-streamdeck-studio': '1',
            }),
          );
          assert.strictEqual((yield* client.execute(unauthorized)).status, 403);
          const saved = yield* client.execute(request('http://127.0.0.1:3901'));
          assert.strictEqual(saved.status, 200);
          assert.strictEqual((yield* controller.snapshot).keys[0]!.count, 8);
          const stale = request('http://127.0.0.1:3901').pipe(
            HttpClientRequest.bodyJsonUnsafe({ ...payload, expected: null }),
          );
          assert.strictEqual((yield* client.execute(stale)).status, 409);
          assert.strictEqual((yield* controller.snapshot).keys[0]!.count, 8);
          const trigger = HttpClientRequest.post('/api/trigger').pipe(
            HttpClientRequest.bodyJsonUnsafe({ key: 0 }),
            HttpClientRequest.setHeaders({
              origin: 'http://127.0.0.1:3901',
              'x-streamdeck-studio': '1',
            }),
          );
          assert.strictEqual((yield* client.execute(trigger)).status, 200);
          assert.strictEqual((yield* controller.snapshot).keys[0]!.count, 9);
          const bad = request('http://127.0.0.1:3901').pipe(
            HttpClientRequest.bodyJsonUnsafe({
              key: 0,
              binding: {
                action: 'run-command',
                label: 'Bad',
                parameters: { executable: '', arguments: 'shell text', directory: '' },
              },
            }),
          );
          assert.strictEqual((yield* client.execute(bad)).status, 400);
          assert.strictEqual((yield* controller.snapshot).keys[0]!.binding?.action, 'counter');
          const pluginRequest = HttpClientRequest.post('/api/plugin').pipe(
            HttpClientRequest.bodyJsonUnsafe({ id: 'audio-mixer', enabled: false, expected: true }),
            HttpClientRequest.setHeaders({
              origin: 'http://127.0.0.1:3901',
              'x-streamdeck-studio': '1',
            }),
          );
          assert.strictEqual(
            (yield* client.execute(
              pluginRequest.pipe(
                HttpClientRequest.setHeader('origin', 'https://unrelated.example'),
              ),
            )).status,
            403,
          );
          assert.strictEqual((yield* client.execute(pluginRequest)).status, 200);
          assert.strictEqual((yield* controller.snapshot).dials.at(-1)!.volume, null);
          assert.strictEqual((yield* client.execute(pluginRequest)).status, 409);
          const image = yield* client.get('/api/image/key/0');
          assert.strictEqual(image.headers['content-type'], 'image/png');
          assert.strictEqual(decode(new Uint8Array(yield* image.arrayBuffer)).width, 112);
        }).pipe(Effect.provide(Layer.mergeAll(mock.layer(), demoLayer)));
      }),
    ).pipe(Effect.provide(Layer.mergeAll(NodeHttpServer.layerTest, NodeServices.layer))),
);

it.live('long-running commands are guarded, cancellable and released with the owner scope', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const node = yield* Config.String('npm_node_execpath');
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-child-' });
      const mock = Mock.make();
      const child = yield* Effect.scoped(
        Effect.gen(function* () {
          const actions = yield* Actions.make(yield* StreamDeck, `${directory}/profile.json`, []);
          yield* actions.save(0, {
            label: 'Longue',
            action: 'run-command',
            parameters: {
              executable: node,
              arguments: ['-e', 'console.log(process.pid); setInterval(() => {}, 10000)'],
              directory: '',
            },
          });
          yield* actions.press(0);
          const started = yield* Effect.repeat(actions.states, {
            until: (states) => !!states.get(0)?.detail.trim(),
            schedule: Schedule.spaced(10),
          });
          const firstPid = Number(started.get(0)!.detail.trim());
          assert.strictEqual((yield* Effect.result(actions.press(0)))._tag, 'Failure');
          assert.strictEqual((yield* Effect.result(actions.save(0, null)))._tag, 'Failure');
          yield* actions.cancel(0);
          assert.strictEqual((yield* actions.states).get(0)?.status, 'idle');
          assert.strictEqual(yield* fs.exists(`/proc/${firstPid}`), false);
          yield* actions.press(0);
          const again = yield* Effect.repeat(actions.states, {
            until: (states) => !!states.get(0)?.detail.trim(),
            schedule: Schedule.spaced(10),
          });
          return Number(again.get(0)!.detail.trim());
        }).pipe(Effect.provide(mock.layer())),
      );
      assert.strictEqual(yield* fs.exists(`/proc/${child}`), false);
      assert.strictEqual(mock.closes, 1);
    }),
  ).pipe(Effect.provide(NodeServices.layer), Effect.timeout('5 seconds')),
);
