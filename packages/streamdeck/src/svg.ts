import { NodeFileSystem } from '@effect/platform-node';
import { Effect, FileSystem, Ref } from 'effect';
import { fileURLToPath } from 'node:url';
import { StreamDeckError, invalid } from './errors.ts';
import type { RgbImage } from './image.ts';

export const escapeXml = (text: string) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
const fontFiles = ['LiberationSans-Regular.ttf', 'LiberationSans-Bold.ttf'].map((name) => fileURLToPath(new URL(`../assets/fonts/${name}`, import.meta.url)));
export const fontFamily = 'Liberation Sans';
const failure = (cause: unknown) => new StreamDeckError({ reason: 'Driver', operation: 'svg', message: 'SVG rendering failed.', cause });

/** Optional Node renderer boundary. HID discovery and bitmap demos never load it. */
export const make = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  yield* Effect.forEach(fontFiles, (path) => fs.access(path));
  const native = yield* Effect.tryPromise({ try: () => import('@resvg/resvg-js'), catch: failure });
  const options = { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: fontFamily }, textRendering: 1 as const };
  const measurements = yield* Ref.make<ReadonlyMap<string, number>>(new Map());
  const measure = (text: string, size = 15, weight = 700) => Effect.gen(function*() {
    const key = JSON.stringify([text, size, weight]); const cache = yield* Ref.get(measurements);
    const cached = cache.get(key); if (cached !== undefined) return cached;
    const width = yield* Effect.try({ try: () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4096" height="100"><text x="0" y="50" font-family="${fontFamily}" font-size="${size}" font-weight="${weight}">${escapeXml(text)}</text></svg>`;
      const box = new native.Resvg(svg, options).getBBox();
      return box ? box.x + box.width : 0;
    }, catch: failure });
    yield* Ref.update(measurements, (cache) => new Map([...(cache.size < 256 ? cache : []), [key, width]]));
    return width;
  });
  const fit = (text: string, width: number, size = 15) => Effect.gen(function*() {
    const chars = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].slice(0, 120).map((part) => part.segment);
    if ((yield* measure(chars.join(''), size)) <= width) return chars.join('');
    let low = 0; let high = chars.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((yield* measure(`${chars.slice(0, middle).join('')}…`, size)) <= width) low = middle; else high = middle - 1;
    }
    return `${chars.slice(0, low).join('')}…`;
  });
  const render = (svg: string) => Effect.tryPromise({ try: (signal) => native.renderAsync(svg, options, signal), catch: failure });
  return {
    fit, measure,
    rgb: (svg: string) => Effect.gen(function*() {
      const rendered = yield* render(svg);
      if (rendered.width * rendered.height > 4_000_000) return yield* Effect.fail(invalid('svg', 'Maximum image size is 4 megapixels.'));
      const rgba = rendered.pixels; const data = new Uint8Array(rendered.width * rendered.height * 3);
      for (let source = 0, target = 0; source < rgba.length; source += 4, target += 3) {
        data[target] = rgba[source]!; data[target + 1] = rgba[source + 1]!; data[target + 2] = rgba[source + 2]!;
      }
      return { width: rendered.width, height: rendered.height, data } satisfies RgbImage;
    }),
    png: (svg: string) => Effect.map(render(svg), (image) => image.asPng()),
  };
}).pipe(Effect.mapError((cause) => cause instanceof StreamDeckError ? cause : failure(cause)), Effect.provide(NodeFileSystem.layer));
export type Renderer = Effect.Success<typeof make>;
