// Tiny local bitmap alphabet avoids native image/font dependencies.
const glyphs: Record<string, readonly string[]> = {
  H: ['101', '101', '111', '101', '101'],
  E: ['111', '100', '110', '100', '111'],
  L: ['100', '100', '100', '100', '111'],
  O: ['111', '101', '101', '101', '111'],
  K: ['101', '101', '110', '101', '101'],
};

export function keyImage(width: number, height: number, pressed: boolean, level: number): Uint8Array {
  const buffer = new Uint8Array(width * height * 3);
  const color = pressed ? [28, 140, 66] : [20, 45, 105];
  const pixel = (x: number, y: number, rgb: readonly number[]) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    buffer.set(rgb, (y * width + x) * 3);
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixel(x, y, color);
  const text = pressed ? 'OK' : 'HELLO';
  const scale = Math.max(1, Math.floor(Math.min(width / (text.length * 4 + 2), height / 9)));
  const left = Math.floor((width - (text.length * 4 - 1) * scale) / 2);
  const top = Math.floor((height - 5 * scale) / 2);
  for (let i = 0; i < text.length; i++) {
    glyphs[text[i]!]!.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === '1') {
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) pixel(left + (i * 4 + x) * scale + dx, top + y * scale + dy, [255, 255, 255]);
      }
    });
  }
  for (let y = height - Math.max(2, scale); y < height; y++) for (let x = 0; x < Math.round(width * level / 100); x++) pixel(x, y, [70, 220, 235]);
  return buffer;
}
