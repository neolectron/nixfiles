import { assert, it } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Layer, Ref, Result, Schedule, Stream } from 'effect';
import { Driver } from '../src/driver.ts';
import { DeckConnection } from '../src/deck-connection.ts';
import * as StudioDevice from '../src/studio-device.ts';
import * as Mock from '../src/mock.ts';
import * as Image from '../src/image.ts';
import * as Audio from '../src/audio.ts';
import { StreamDeck } from '../src/stream-deck.ts';
import { startStudio } from '../src/scripts/studio.ts';

const setup = Effect.gen(function* () {
  const mock = Mock.make();
  const present = yield* Ref.make(false);
  const driver = Layer.effect(
    Driver,
    Effect.gen(function* () {
      const original = yield* Driver;
      return Driver.of({
        ...original,
        list: Ref.get(present).pipe(
          Effect.flatMap((found) => (found ? original.list : Effect.succeed([]))),
        ),
      });
    }),
  ).pipe(Layer.provide(mock.driverLayer));
  const connection = DeckConnection.layer().pipe(Layer.provide(driver));
  const deck = StreamDeck.layer().pipe(
    Layer.provide(StudioDevice.driverLayer),
    Layer.provide(connection),
  );
  return { mock, present, layer: Layer.mergeAll(connection, deck) };
});
const wait = (condition: Effect.Effect<boolean>) =>
  Effect.repeat(condition, { until: Boolean, schedule: Schedule.spaced(10) }).pipe(
    Effect.timeout(3000),
  );

it.live(
  'USB service reports DeckOffline, reconnects and scopes every native handle independently of the canvas',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const state = yield* setup;
        yield* Effect.scoped(
          Effect.gen(function* () {
            const usb = yield* DeckConnection;
            const deck = yield* StreamDeck;
            const result = yield* Effect.result(usb.use((physical) => physical.serialNumber));
            assert.ok(Result.isFailure(result));
            assert.strictEqual(result.failure._tag, 'DeckOffline');
            const event = yield* Stream.toPull(yield* deck.subscribe);
            const key = yield* Image.solid({ width: 112, height: 112 }, [10, 20, 30]);
            yield* deck.key(0).setImage(key);
            key.data.fill(255);
            yield* deck
              .lcd(0)
              .drawRegion(
                { x: 10, y: 2 },
                yield* Image.solid({ width: 4, height: 3 }, [40, 50, 60]),
              );
            yield* deck.setBrightness(42);
            assert.strictEqual(state.mock.writes.length, 0);
            yield* Ref.set(state.present, true);
            yield* wait(usb.connected);
            assert.strictEqual(state.mock.opens, 1);
            assert.strictEqual(yield* usb.use((physical) => physical.serialNumber), 'mock-serial');
            const firstKey = state.mock.writes.find((write) => write.kind === 'key');
            assert.ok(firstKey && firstKey.kind === 'key');
            assert.deepStrictEqual([...firstKey.image.data.subarray(0, 3)], [10, 20, 30]);
            const firstLcd = state.mock.writes.find((write) => write.kind === 'lcd');
            assert.ok(firstLcd && firstLcd.kind === 'lcd');
            assert.deepStrictEqual(
              [...firstLcd.image.data.subarray((2 * 1200 + 10) * 3, (2 * 1200 + 10) * 3 + 3)],
              [40, 50, 60],
            );
            assert.ok(
              state.mock.writes.some(
                (write) => write.kind === 'brightness' && write.percent === 42,
              ),
            );
            yield* state.mock.emit({ _tag: 'KeyDown', key: 0 });
            assert.deepStrictEqual((yield* event)[0], { _tag: 'KeyDown', key: 0 });
            yield* Ref.set(state.present, false);
            yield* state.mock.disconnect();
            yield* wait(Effect.map(usb.connected, (connected) => !connected));
            yield* deck.key(0).fill([70, 80, 90]);
            assert.strictEqual(
              (yield* Effect.result(usb.use((physical) => physical.serialNumber)))._tag,
              'Failure',
            );
            yield* Ref.set(state.present, true);
            yield* wait(usb.connected);
            assert.strictEqual(state.mock.opens, 2);
            const lastKey = state.mock.writes.filter((write) => write.kind === 'key').at(-1);
            assert.ok(lastKey && lastKey.kind === 'key');
            assert.deepStrictEqual([...lastKey.image.data.subarray(0, 3)], [70, 80, 90]);
          }),
        ).pipe(Effect.provide(state.layer));
        assert.strictEqual(state.mock.opens, state.mock.closes);
      }),
    ),
);

it.live(
  'Studio stays functional offline: shared web gestures update plugin feedback and its rendered preview',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-offline-' });
        const state = yield* setup;
        yield* Effect.scoped(
          Effect.gen(function* () {
            const studio = yield* startStudio({
              profile: `${directory}/profile.json`,
              applications: [],
              configurePlugins: () => Effect.void,
            });
            yield* Effect.forkScoped(studio.run);
            const before = yield* studio.snapshot;
            assert.strictEqual(before.connected, false);
            assert.strictEqual(before.mock, false);
            assert.ok(before.connectionError);
            yield* studio.actions.save(0, {
              label: 'Offline',
              action: 'counter',
              parameters: { start: 0 },
              trigger: { type: 'double-tap', milliseconds: 100 },
            });
            const current = yield* studio.snapshot;
            const key = current.keys[0]!;
            const input = (phase: 'down' | 'up') =>
              studio.keyInput({
                key: 0,
                phase,
                address: key.address,
                owner: 'test',
                revision: current.layout.revision,
              });
            yield* input('down');
            yield* input('up');
            yield* input('down');
            yield* input('up');
            const after = yield* studio.snapshot;
            assert.strictEqual(after.keys[0]!.count, 1);
            assert.ok(after.keys[0]!.revision > current.keys[0]!.revision);
            assert.ok((yield* studio.preview.png('key', 0)).length > 0);
            yield* Ref.set(state.present, true);
            yield* wait((yield* DeckConnection).connected);
            assert.strictEqual((yield* studio.snapshot).connected, true);
            yield* state.mock.emit({ _tag: 'KeyDown', key: 0 });
            yield* Ref.set(state.present, false);
            yield* state.mock.disconnect();
            yield* Effect.sleep(150);
            assert.strictEqual((yield* studio.snapshot).keys[0]!.pressed, false);
            assert.strictEqual((yield* studio.snapshot).keys[0]!.count, 1);
          }),
        ).pipe(Effect.provide(Layer.mergeAll(state.layer, Audio.demoLayer)));
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);
