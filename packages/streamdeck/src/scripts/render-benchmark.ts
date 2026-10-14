import { invariant } from '../errors.ts';
import { Clock, Console, Effect } from 'effect';
import * as Display from '../mixer-renderer.ts';
const rounded = (n: number) => Math.round(n * 1000) / 1000;
/** Raster timings only: no USB handle, audio command or browser is involved. */
export const benchmark = Effect.gen(function* () {
  for (const renderer of ['svg', 'react'] as const) {
    const initStart = yield* Clock.monotonicTimeNanos;
    const display = yield* Display.make(renderer);
    const initMillis = Number((yield* Clock.monotonicTimeNanos) - initStart) / 1e6;
    yield* display.card(
      { width: 216, height: 100 },
      { name: 'Spotify', volume: 100, muted: false },
      true,
    );
    const samples: number[] = [];
    for (let i = 0; i < 40; i++) {
      const start = yield* Clock.monotonicTimeNanos;
      yield* display.card(
        { width: 216, height: 100 },
        { name: 'Spotify', volume: 100 + i * 2, muted: false },
        true,
      );
      samples.push(Number((yield* Clock.monotonicTimeNanos) - start) / 1e6);
    }
    samples.sort((a, b) => a - b);
    yield* Console.log(
      JSON.stringify({
        kind: 'renderer-benchmark',
        renderer,
        samples: samples.length,
        width: 216,
        height: 100,
        includesUsb: false,
        initMillis: rounded(initMillis),
        p50Millis: rounded(invariant(samples[20], 'render-benchmark')),
        p95Millis: rounded(invariant(samples[38], 'render-benchmark')),
        maxMillis: rounded(invariant(samples.at(-1), 'render-benchmark')),
      }),
    );
  }
});
