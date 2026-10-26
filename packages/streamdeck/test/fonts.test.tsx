import { assert, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import * as Takumi from '../src/takumi.ts';
import * as Svg from '../src/svg.ts';
import { cjkFont } from '../src/fonts.ts';
import { NowPlayingCard } from '../src/ui/now-playing-card.tsx';

// Run inside packages/streamdeck/shell.nix, also exercised by the Nix package check.
it.live(
  'renders distinct Japanese glyphs in Takumi and SVG rather than repeated missing boxes',
  () =>
    Effect.gen(function* () {
      assert.isTrue(Option.isSome(yield* cjkFont), 'Use the Nix development shell for CJK fonts.');
      const react = yield* Takumi.make;
      const svg = yield* Svg.make;
      const size = { width: 64, height: 64 };
      const reactGlyphs: Uint8Array[] = [];
      const svgGlyphs: Uint8Array[] = [];
      for (const glyph of '日本語の音楽テスト') {
        reactGlyphs.push(
          yield* react.png(
            <div style={{ ...size, fontFamily: 'Liberation Sans', fontSize: 32 }}>{glyph}</div>,
            size,
          ),
        );
        svgGlyphs.push(
          yield* svg.png(
            `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><text x="0" y="40" font-family="Liberation Sans" font-size="32">${glyph}</text></svg>`,
          ),
        );
      }
      for (const images of [reactGlyphs, svgGlyphs])
        for (let i = 0; i < images.length; i++)
          for (let j = i + 1; j < images.length; j++) assert.notDeepEqual(images[i], images[j]);

      // The real LCD component must retain its title/artist raster and RGB dimensions.
      const card = (title: string, artist: string) => (
        <NowPlayingCard
          width={432}
          height={100}
          app={{ name: 'Test', volume: 72, muted: false, hasAudio: true }}
          track={{ title, artists: [artist], status: 'Paused', durationMicros: 180_000_000 }}
          position={30_000_000}
        />
      );
      const japanese = yield* react.rgb(card('日本語の音楽 テスト', '東京'), {
        width: 432,
        height: 100,
      });
      const boxes = yield* react.rgb(card('□□□□□□□□□□□', '□□'), { width: 432, height: 100 });
      assert.strictEqual(japanese.data.length, 432 * 100 * 3);
      assert.notDeepEqual(japanese.data, boxes.data);

      // A tall CJK line box must not cut the bottom strokes off the fixed-height LCD title.
      const reference = yield* react.rgb(
        <div
          style={{
            ...size,
            fontFamily: 'Liberation Sans',
            fontSize: 18,
            fontWeight: 700,
            lineHeight: '19px',
            color: '#F4F4F7',
            background: '#35353F',
          }}
        >
          音
        </div>,
        size,
      );
      const title = yield* react.rgb(card('音', ''), { width: 432, height: 100 });
      const ink = (image: Uint8Array) => {
        let pixels = 0;
        for (let offset = 0; offset < image.length; offset += 3)
          if (image[offset] === 244 && image[offset + 1] === 244 && image[offset + 2] === 247)
            pixels++;
        return pixels;
      };
      assert.isAbove(ink(reference.data), 0);
      assert.strictEqual(ink(title.data), ink(reference.data));
    }),
);
