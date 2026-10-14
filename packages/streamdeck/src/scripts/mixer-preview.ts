import { invariant } from '../errors.ts';
import { Console, Effect, FileSystem } from 'effect';
import * as Display from '../mixer-renderer.ts';
import * as Svg from '../svg.ts';
/** Render the shipped card renderer at actual + XL dimensions, without HID/audio. */
export const preview = (output: string, kind: Display.RendererKind = 'svg') =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const display = yield* Display.make(kind);
    const composer = yield* Svg.make;
    const widths = [168, 216, 216, 216, 216, 168];
    const rows = [
      [
        { name: 'Discord', volume: 64, muted: false },
        { name: 'Spotify', volume: 72, muted: false },
        { name: 'Google Chrome', volume: 90, muted: false },
        { name: 'Music', volume: 100, muted: false },
        { name: 'Music', volume: 125, muted: false },
        { name: 'Master', volume: 150, muted: false },
      ],
      [
        { name: 'Spotify', volume: 0, muted: false },
        { name: 'Discord', volume: 100, muted: true },
        { name: 'Très longue application audio', volume: 85, muted: false },
        undefined,
        { name: 'Discord', volume: 75, muted: false, mixedMute: true },
        { name: 'Master', volume: 100, muted: false },
      ],
      [
        { name: 'Music', volume: 45, muted: false },
        { name: 'Spotify', volume: 110, muted: false },
        { name: 'Google Chrome', volume: 150, muted: false },
        { name: 'Music', volume: 175, muted: false },
        { name: 'Spotify', volume: 200, muted: false },
        undefined,
      ],
    ];
    const images: string[] = [];
    for (const [row, cards] of rows.entries()) {
      let x = 0;
      for (const [i, card] of cards.entries()) {
        const png = yield* display.png(
          { width: invariant(widths[i], 'mixer-preview'), height: 100 },
          card,
          row !== 2 || i !== 0,
          i === 5 ? 'MASTER' : undefined,
        );
        images.push(
          `<image x="${x}" y="${row * 108}" width="${widths[i]}" height="100" href="data:image/png;base64,${png.toString('base64')}"/>`,
        );
        x += invariant(widths[i], 'mixer-preview');
      }
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="316"><rect width="1200" height="316" fill="#0D0D10"/>${images.join('')}</svg>`;
    yield* fs.writeFile(output, yield* composer.png(svg));
    yield* Console.log(`Mixer preview (illustrative values, ${kind}): ${output}`);
  });
