import { Effect } from 'effect';
import { invalid } from './errors.ts';
import type { Color, Size } from './model.ts';

/** Logical, unrotated RGB pixels. Encoding and device orientation belong to HID. */
export interface RgbImage extends Size { readonly data: Uint8Array }
export interface LabelOptions {
  readonly background?: Color;
  readonly foreground?: Color;
  readonly level?: number;
}
const glyphs: Record<string, string> = {
  A:'010101111101101', B:'110101110101110', C:'111100100100111', D:'110101101101110',
  E:'111100110100111', F:'111100110100100', G:'111100101101111', H:'101101111101101',
  I:'111010010010111', J:'001001001101111', K:'101101110101101', L:'100100100100111',
  M:'101111111101101', N:'101111111111101', O:'111101101101111', P:'110101110100100',
  Q:'111101101111001', R:'110101110101101', S:'111100111001111', T:'111010010010010',
  U:'101101101101111', V:'101101101101010', W:'101101111111101', X:'101101010101101',
  Y:'101101010010010', Z:'111001010100111', '0':'111101101101111', '1':'010110010010111',
  '2':'111001111100111', '3':'111001111001111', '4':'101101111001001', '5':'111100111001111',
  '6':'111100111101111', '7':'111001010010010', '8':'111101111101111', '9':'111101111001111',
  ' ':'000000000000000', '-':'000000111000000', '?':'111001010000010', '+':'000010111010000', '%':'101001010100101',
};
const validSize = (size: Size) => Number.isSafeInteger(size.width) && Number.isSafeInteger(size.height)
  && size.width > 0 && size.height > 0 && size.width * size.height <= 4_194_304;
export const validColor = (color: Color) => color.length === 3 && color.every((value) => Number.isInteger(value) && value >= 0 && value <= 255);
export const validate = (image: RgbImage) => validSize(image) && image.data instanceof Uint8Array
  && image.data.length === image.width * image.height * 3;
export const solid = (size: Size, color: Color) => Effect.suspend(() => {
  if (!validSize(size) || !validColor(color)) return Effect.fail(invalid('image', 'Invalid RGB color or dimensions (maximum 4 megapixels).'));
  const data = new Uint8Array(size.width * size.height * 3);
  for (let offset = 0; offset < data.length; offset += 3) data.set(color, offset);
  return Effect.succeed({ ...size, data });
});
/** A small dependency-free label renderer for scripts, not a font engine. */
export const label = (size: Size, text: string, options: LabelOptions = {}) => Effect.gen(function*() {
  const foreground = options.foreground ?? [255, 255, 255];
  if (!validColor(foreground) || (options.level !== undefined && (!Number.isFinite(options.level) || options.level < 0 || options.level > 100))) {
    return yield* Effect.fail(invalid('label', 'Foreground must be RGB bytes; level must be in 0..100.'));
  }
  const image = yield* solid(size, options.background ?? [20, 45, 105]);
  const chars = [...text.toUpperCase()].slice(0, Math.max(1, Math.floor(size.width / 4)));
  const scale = Math.max(1, Math.floor(Math.min(size.width / Math.max(1, chars.length * 4 + 2), size.height / 9)));
  const left = Math.floor((size.width - (chars.length * 4 - 1) * scale) / 2);
  const top = Math.floor((size.height - 5 * scale) / 2);
  const pixel = (x: number, y: number, color: Color) => {
    if (x >= 0 && x < size.width && y >= 0 && y < size.height) image.data.set(color, (y * size.width + x) * 3);
  };
  chars.forEach((char, i) => {
    const glyph = glyphs[char] ?? glyphs['?']!;
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if (glyph[y * 3 + x] === '1') {
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) pixel(left + (i * 4 + x) * scale + dx, top + y * scale + dy, foreground);
    }
  });
  if (options.level !== undefined) {
    for (let y = size.height - Math.max(2, scale); y < size.height; y++) for (let x = 0; x < Math.round(size.width * options.level / 100); x++) pixel(x, y, [70, 220, 235]);
  }
  return image;
});
