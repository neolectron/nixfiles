import { assert, it } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Layer, Ref } from 'effect';
import { TestClock } from 'effect/testing';
import * as Mock from '../src/mock.ts';
import * as Audio from '../src/audio.ts';
import * as Plugin from '../src/plugin.ts';
import * as Bindings from '../src/bindings.ts';
import { startStudio } from '../src/scripts/studio.ts';

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
