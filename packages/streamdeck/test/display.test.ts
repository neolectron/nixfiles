import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import { StreamDeckError } from '../src/errors.ts';
import * as Display from '../src/mixer-display.ts';
import * as Svg from '../src/svg.ts';

test('bundled font metrics fit long accented names and XML text remains literal', async () => {
  const display = await Effect.runPromise(Display.make);
  for (const width of [111, 159]) {
    const label = await Effect.runPromise(display.renderer.fit('Très longue application audio', width));
    assert.ok(label.endsWith('…')); assert.ok(await Effect.runPromise(display.renderer.measure(label)) <= width);
  }
  const svg = await Effect.runPromise(display.svg({ width: 216, height: 100 }, { name: 'A&B <X>', volume: 125, muted: false }, true));
  assert.match(svg, /A&amp;B &lt;X&gt;/); assert.doesNotMatch(svg, /A&B <X>/);
  const image = await Effect.runPromise(display.renderer.rgb(svg));
  assert.equal(image.data.length, 216 * 100 * 3);
});

test('renderer handles all feedback states and reports invalid native SVG/dimensions as typed failures', async () => {
  const display = await Effect.runPromise(Display.make);
  for (const width of [168, 216]) for (const state of [
    { app: { name: 'Discord', volume: 100, muted: true }, online: true },
    { app: { name: 'Spotify', volume: 200, muted: false }, online: true },
    { app: undefined, online: true }, { app: undefined, online: false },
  ]) {
    const image = await Effect.runPromise(display.card({ width, height: 100 }, state.app, state.online));
    assert.equal(image.width, width); assert.equal(image.height, 100); assert.equal(image.data.length, width * 100 * 3);
  }
  await assert.rejects(Effect.runPromise(display.card({ width: 1, height: 100 }, undefined, true)), StreamDeckError);
  await assert.rejects(Effect.runPromise(display.renderer.rgb('<svg')), StreamDeckError);
  assert.equal(Svg.escapeXml('<&"\''), '&lt;&amp;&quot;&apos;');
});

test('Effect CLI preview writes a valid full-strip PNG with no HID, pactl or external font lookup', () => {
  const directory = mkdtempSync(join(tmpdir(), 'streamdeck-display-')); const output = join(directory, 'preview.png');
  try {
    const result = spawnSync(process.execPath, ['src/cli.ts', 'preview', '--output', output], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, PATH: '/nonexistent', LD_LIBRARY_PATH: '', FONTCONFIG_FILE: '/nonexistent' },
    });
    assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /illustrative values/);
    const png = readFileSync(output);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), 1200); assert.equal(png.readUInt32BE(20), 316);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
