import { assert, it } from '@effect/vitest';
import { NodeServices, NodeHttpServer } from '@effect/platform-node';
import { Effect, FileSystem, Layer, Ref, Schedule } from 'effect';
import { HttpClient, HttpClientRequest, HttpServer } from 'effect/http';
import { TestClock } from 'effect/testing';
import * as Mock from '../src/mock.ts';
import * as Audio from '@nixfiles/system-control/audio.ts';
import * as Plugin from '../src/plugin.ts';
import * as Bindings from '../src/bindings.ts';
import { startStudio, httpApp } from '../src/scripts/studio.ts';

it.live(
  'browser dial requests use plugin events, preserve target identity and enforce the HTTP input boundary',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-dial-http-' });
        const mock = Mock.make();
        const turns = yield* Ref.make(0);
        yield* Effect.gen(function* () {
          const studio = yield* startStudio({
            profile: `${directory}/profile.json`,
            mock: true,
            applications: [],
            configurePlugins: (host) =>
              host.install(
                Plugin.define({
                  id: 'dial-test',
                  name: 'Dial',
                  description: 'Shared encoder input',
                  controls: { dials: [0] },
                  setup: Effect.gen(function* () {
                    const binding = yield* Bindings.start({
                      knobs: {
                        0: {
                          onRotate: ({ delta }) => Ref.update(turns, (before) => before + delta),
                        },
                      },
                    });
                    return { api: {}, run: binding.run };
                  }),
                }),
              ),
          });
          yield* studio.plugins.setEnabled('audio-mixer', false);
          yield* studio.plugins.setEnabled('dial-test', true);
          yield* Effect.forkScoped(studio.run);
          const server = yield* HttpServer.HttpServer;
          if (server.address._tag === 'UnixPathAddress') throw new Error('Expected TCP');
          const base = `http://127.0.0.1:${server.address.port}`;
          yield* server.serve(yield* httpApp(studio, [base]));
          const client = yield* HttpClient.HttpClient;
          const view = yield* studio.snapshot;
          const body = {
            dial: 0,
            delta: 3,
            application: view.dials[0]?.key ?? null,
            page: view.page,
            sessionId: view.sessionId,
          };
          const post = (patch: Partial<typeof body> = {}, origin = base) =>
            client.execute(
              HttpClientRequest.post('/api/dial-input').pipe(
                HttpClientRequest.setHeader('origin', origin),
                HttpClientRequest.setHeader('x-streamdeck-studio', '1'),
                HttpClientRequest.bodyJsonUnsafe({ ...body, ...patch }),
              ),
            );
          assert.strictEqual((yield* post()).status, 200);
          yield* Ref.get(turns).pipe(
            Effect.repeat({ until: (value) => value === 3, schedule: Schedule.spaced(5) }),
          );
          assert.strictEqual((yield* studio.snapshot).dials[0]?.rotationSteps, 3);
          assert.strictEqual((yield* post({ delta: -2 })).status, 200);
          yield* Ref.get(turns).pipe(
            Effect.repeat({ until: (value) => value === 1, schedule: Schedule.spaced(5) }),
          );
          for (const patch of [
            { application: 'other' },
            { page: view.page + 1 },
            { sessionId: 'old' },
          ])
            assert.strictEqual((yield* post(patch)).status, 409);
          assert.strictEqual((yield* post({ dial: 100 })).status, 400);
          assert.strictEqual((yield* post({ delta: 100 })).status, 400);
          assert.strictEqual((yield* post({}, 'https://foreign.example')).status, 403);
          assert.strictEqual(yield* Ref.get(turns), 1);
        }).pipe(
          Effect.scoped,
          Effect.provide(Layer.mergeAll(mock.layer(), Audio.demoLayer, NodeHttpServer.layerTest)),
        );
      }),
    ).pipe(Effect.provide(NodeServices.layer), Effect.timeout('5 seconds')),
);

it.effect(
  'dial rotation feedback accumulates signed cranks independently of volume caps and held controls',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-dials-' });
        const mock = Mock.make();
        yield* Effect.gen(function* () {
          yield* (yield* Audio.Audio).setMasterVolume(150);
          const studio = yield* startStudio({
            profile: `${directory}/profile.json`,
            applications: [],
            mock: true,
            configurePlugins: () => Effect.void,
          });
          yield* Effect.forkScoped(studio.run);
          const emit = (event: Parameters<typeof mock.emit>[0]) =>
            mock.emit(event).pipe(Effect.andThen(TestClock.adjust(0)));
          assert.strictEqual((yield* studio.snapshot).dials[0]?.rotationSteps, 0);
          yield* emit({ _tag: 'DialRotate', dial: 0, delta: 3 });
          yield* emit({ _tag: 'DialRotate', dial: 0, delta: -5 });
          yield* emit({ _tag: 'DialRotate', dial: 5, delta: 100 });
          yield* emit({ _tag: 'DialDown', dial: 0 });
          yield* emit({ _tag: 'DialRotate', dial: 0, delta: 1 });
          const view = yield* studio.snapshot;
          assert.strictEqual(view.dials[0]?.rotationSteps, -1);
          assert.strictEqual(view.dials[0]?.pressed, true);
          assert.strictEqual(view.dials[1]?.rotationSteps, 0);
          assert.strictEqual(view.dials[5]?.rotationSteps, 100);
          assert.strictEqual(view.dials[5]?.volume, 150);
          assert.strictEqual(view.inputSequence, 5);
          yield* emit({ _tag: 'DialUp', dial: 0 });
          assert.strictEqual((yield* studio.snapshot).dials[0]?.rotationSteps, -1);
          assert.strictEqual((yield* studio.snapshot).dials[0]?.pressed, false);
        }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(mock.layer(), Audio.demoLayer)));
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect(
  'browser events reach owned plugin bindings: exclusive gestures, independent clients and cancellation',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-events-' });
        const counts = yield* Ref.make({ short: 0, long: 0, double: 0 });
        yield* Effect.gen(function* () {
          const studio = yield* startStudio({
            profile: `${directory}/profile.json`,
            applications: [],
            configurePlugins: (host) =>
              host.install(
                Plugin.define({
                  id: 'gestures-test',
                  name: 'Gestures',
                  description: 'Exercise the shared semantic input API.',
                  controls: { keys: [0] },
                  setup: Effect.gen(function* () {
                    const binding = yield* Bindings.start({
                      buttons: {
                        0: {
                          onShortPress: Ref.update(counts, (before) => ({
                            ...before,
                            short: before.short + 1,
                          })),
                          onLongPress: Ref.update(counts, (before) => ({
                            ...before,
                            long: before.long + 1,
                          })),
                          onDoubleTap: Ref.update(counts, (before) => ({
                            ...before,
                            double: before.double + 1,
                          })),
                          longPressMs: 100,
                          doubleTapMs: 100,
                        },
                      },
                    });
                    return { api: {}, run: binding.run };
                  }),
                }),
              ),
          });
          yield* studio.plugins.setEnabled('shortcuts', false);
          yield* studio.plugins.setEnabled('gestures-test', true);
          yield* Effect.forkScoped(studio.run);
          const snapshot = yield* studio.snapshot;
          const input = (
            phase: 'down' | 'up' | 'cancel',
            owner = 'alpha',
            revision = snapshot.layout.revision,
          ) =>
            studio
              .keyInput({ key: 0, phase, owner, address: snapshot.keys[0]!.address, revision })
              .pipe(Effect.andThen(TestClock.adjust(0)));
          yield* input('down');
          yield* input('up');
          yield* TestClock.adjust(101);
          assert.deepStrictEqual(yield* Ref.get(counts), { short: 1, long: 0, double: 0 });
          yield* input('down');
          yield* input('up');
          yield* input('down');
          yield* input('up');
          assert.deepStrictEqual(yield* Ref.get(counts), { short: 1, long: 0, double: 1 });
          yield* input('down');
          yield* TestClock.adjust(100);
          yield* input('up');
          assert.deepStrictEqual(yield* Ref.get(counts), { short: 1, long: 1, double: 1 });
          yield* input('down');
          yield* input('cancel');
          yield* TestClock.adjust(200);
          assert.deepStrictEqual(yield* Ref.get(counts), { short: 1, long: 1, double: 1 });
          yield* input('down', 'alpha');
          yield* input('down', 'beta');
          yield* input('cancel', 'alpha');
          assert.strictEqual((yield* studio.snapshot).keys[0]!.pressed, true);
          yield* input('cancel', 'beta', snapshot.layout.revision - 1);
          assert.strictEqual((yield* studio.snapshot).keys[0]!.pressed, true);
          yield* TestClock.adjust(100);
          assert.strictEqual((yield* Ref.get(counts)).long, 2);
          yield* input('up', 'beta');
          assert.strictEqual((yield* studio.snapshot).keys[0]!.pressed, false);
        }).pipe(Effect.provide(Layer.mergeAll(Mock.make().layer(), Audio.demoLayer)));
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);
