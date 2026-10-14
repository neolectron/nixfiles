import { assert, it } from '@effect/vitest';
import { Effect, Fiber, Layer, Schedule } from 'effect';
import * as ReactDisplay from '../src/react-mixer.tsx';
import { Audio, demoLayer } from '@nixfiles/system-control/audio.ts';
import * as Mock from '../src/mock.ts';
import { make as startMixer } from '../src/plugins/audio-mixer.ts';

it.live('React/Takumi produces exact-size RGB and PNG with nominal/boost/mute/offline states', () =>
  Effect.gen(function* () {
    const display = yield* ReactDisplay.make;
    for (const width of [168, 216])
      for (const state of [
        { app: { name: 'A&B <X>', volume: 100, muted: false }, online: true },
        { app: { name: 'Spotify', volume: 150, muted: false }, online: true },
        { app: { name: 'Discord', volume: 125, muted: true }, online: true },
        { app: undefined, online: false },
      ]) {
        const image = yield* display.card(
          { width, height: 100 },
          state.app,
          state.online,
          'MASTER',
        );
        assert.strictEqual(image.data.length, width * 100 * 3);
        assert.deepStrictEqual([...image.data.subarray(0, 3)], [13, 13, 16]);
      }
    const png = yield* display.png(
      { width: 168, height: 100 },
      { name: 'Master', volume: 150, muted: false },
      true,
      'MASTER',
    );
    assert.deepStrictEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const header = new DataView(png.buffer, png.byteOffset, png.byteLength);
    assert.strictEqual(header.getUint32(16), 168);
    assert.strictEqual(header.getUint32(20), 100);
  }),
);

it.live(
  'React mixer routes physical swipe and subsequent dial to the displayed app, keeping Master fixed',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const deck = Mock.make();
        yield* Effect.gen(function* () {
          const mixer = yield* startMixer({
            renderer: 'react',
            refreshMillis: 60_000,
            flushMillis: 60_000,
          });
          const initial = yield* mixer.state;
          const masterPaints = deck.writes.filter(
            (write) => write.kind === 'region' && write.position.x === 1000,
          ).length;
          const fiber = yield* Effect.forkScoped(mixer.run);
          yield* deck.emit({
            _tag: 'TouchSwipe',
            lcd: 0,
            from: { x: 500, y: 50 },
            to: { x: 100, y: 50 },
          });
          const page = yield* Effect.repeat(mixer.state, {
            until: (state) => state.page === 1,
            schedule: Schedule.spaced(1),
          });
          assert.strictEqual(page.master?.volume, initial.master?.volume);
          assert.strictEqual(
            deck.writes.filter((write) => write.kind === 'region' && write.position.x === 1000)
              .length,
            masterPaints,
          );
          const key = page.assignments[5]!;
          yield* mixer.adjustDial(0, 1);
          yield* mixer.toggleDial(0);
          yield* mixer.flush;
          const app = (yield* (yield* Audio).list).find((app) => app.key === key)!;
          assert.strictEqual(Math.round(app.volume), 72);
          assert.strictEqual(app.muted, true);
          yield* Fiber.interrupt(fiber);
        }).pipe(
          Effect.provide(Layer.mergeAll(deck.layer(), demoLayer)),
          Effect.timeout('5 seconds'),
        );
        assert.strictEqual(deck.closes, 1);
      }),
    ),
);
