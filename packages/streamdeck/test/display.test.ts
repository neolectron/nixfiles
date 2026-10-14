import { assert, expect, it, test } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Path } from 'effect';
import { StreamDeckError } from '../src/errors.ts';
import * as Display from '../src/mixer-display.ts';
import * as Svg from '../src/svg.ts';
import { cli } from './cli.ts';

test('bundled font metrics fit long accented names and XML text remains literal', async () => {
  const display = await Effect.runPromise(Display.make);
  for (const width of [111, 159]) {
    const label = await Effect.runPromise(
      display.renderer.fit('Très longue application audio', width),
    );
    assert.ok(label.endsWith('…'));
    assert.ok((await Effect.runPromise(display.renderer.measure(label))) <= width);
  }
  const svg = await Effect.runPromise(
    display.svg({ width: 216, height: 100 }, { name: 'A&B <X>', volume: 125, muted: false }, true),
  );
  assert.match(svg, /A&amp;B &lt;X&gt;/);
  assert.notMatch(svg, /A&B <X>/);
  const image = await Effect.runPromise(display.renderer.rgb(svg));
  assert.strictEqual(image.data.length, 216 * 100 * 3);
});

test('Master reaches 150% at the right end while 100% stays vertical; applications retain their 200% sweep', async () => {
  const display = await Effect.runPromise(Display.make);
  for (const [title, volume, angle] of [
    ['MASTER', 100, Math.PI * 1.5],
    ['MASTER', 125, Math.PI * 1.75],
    ['MASTER', 150, Math.PI * 2],
    [undefined, 100, Math.PI * 1.5],
    [undefined, 150, Math.PI * 1.75],
    [undefined, 200, Math.PI * 2],
  ] as const) {
    const svg = await Effect.runPromise(
      display.svg(
        { width: 168, height: 100 },
        { name: 'Music', volume, muted: false },
        true,
        title,
      ),
    );
    const pointer = svg.match(
      /<path d="M ([\d.eE+-]+) ([\d.eE+-]+) L ([\d.eE+-]+) ([\d.eE+-]+)" stroke="#F5F5EA"/,
    );
    assert.ok(pointer);
    assert.closeTo(Number(pointer[3]), 62 + Math.cos(angle) * 27, 1e-8);
    assert.closeTo(Number(pointer[4]), 91 + Math.sin(angle) * 27, 1e-8);
    if (title && volume === 125) assert.include(svg, 'fill="rgb(255,145,30)"');
    if (title && volume === 150) assert.include(svg, 'fill="rgb(255,55,55)"');
  }
});

test('renderer handles all feedback states and reports invalid native SVG/dimensions as typed failures', async () => {
  const display = await Effect.runPromise(Display.make);
  for (const width of [168, 216])
    for (const state of [
      { app: { name: 'Discord', volume: 100, muted: true }, online: true },
      { app: { name: 'Spotify', volume: 200, muted: false }, online: true },
      { app: undefined, online: true },
      { app: undefined, online: false },
    ]) {
      const image = await Effect.runPromise(
        display.card({ width, height: 100 }, state.app, state.online),
      );
      assert.strictEqual(image.width, width);
      assert.strictEqual(image.height, 100);
      assert.strictEqual(image.data.length, width * 100 * 3);
    }
  await expect(
    Effect.runPromise(display.card({ width: 1, height: 100 }, undefined, true)),
  ).rejects.toBeInstanceOf(StreamDeckError);
  await expect(Effect.runPromise(display.renderer.rgb('<svg'))).rejects.toBeInstanceOf(
    StreamDeckError,
  );
  assert.strictEqual(Svg.escapeXml('<&"\''), '&lt;&amp;&quot;&apos;');
});

it.live(
  'Effect CLI preview writes a valid full-strip PNG with no HID, pactl or external font lookup',
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'streamdeck-display-' });
      for (const renderer of ['svg', 'react']) {
        const output = path.join(directory, `${renderer}.png`);
        const result = yield* cli(['preview', '--renderer', renderer, '--output', output], {
          PATH: '/nonexistent',
          LD_LIBRARY_PATH: '',
          FONTCONFIG_FILE: '/nonexistent',
        });
        assert.strictEqual(result.status, 0, result.stderr);
        assert.match(result.stdout, /illustrative values/);
        const png = yield* fs.readFile(output);
        assert.deepStrictEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
        const header = new DataView(png.buffer, png.byteOffset, png.byteLength);
        assert.strictEqual(header.getUint32(16), 1200);
        assert.strictEqual(header.getUint32(20), 316);
      }
    }).pipe(Effect.provide(NodeServices.layer)),
);
