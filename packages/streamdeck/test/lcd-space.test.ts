import { assert, test } from '@effect/vitest';
import { expansionWidth } from '../src/lcd-space.ts';

test('LCD expansion stops at the nearest intersecting claim and preserves the base dial region', () => {
  const anchor = { x: 168, y: 0, width: 216, height: 100 };
  const region = (x: number, width = 200, y = 0) => ({ x, width, y, height: 100 });
  assert.strictEqual(expansionWidth(anchor, 864, []), 864);
  assert.strictEqual(expansionWidth(anchor, 864, [region(0, 168)]), 864);
  assert.strictEqual(expansionWidth(anchor, 864, [region(600, 400)]), 432);
  assert.strictEqual(expansionWidth(anchor, 864, [region(800), region(500)]), 332);
  assert.strictEqual(expansionWidth(anchor, 864, [region(600, 400, 100)]), 864);
  assert.strictEqual(expansionWidth(anchor, 864, [region(384)]), 216);
  // A foreground takeover of the base slot does not move a knob's physical column.
  assert.strictEqual(expansionWidth(anchor, 864, [region(200)]), 216);
});
