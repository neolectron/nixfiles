import { assert, test } from '@effect/vitest';
import { outsideDeck } from '../web/key-drop.ts';

test('only a release inside the viewport and outside the physical deck means deletion', () => {
  const deck = { left: 100, top: 100, right: 800, bottom: 700 };
  const viewport = { width: 1200, height: 900 };
  for (const [x, y] of [
    [50, 200],
    [900, 200],
    [300, 50],
    [300, 800],
  ])
    assert.strictEqual(outsideDeck(x!, y!, deck, viewport), true);
  for (const [x, y] of [
    [100, 100],
    [800, 700],
    [500, 300],
    [500, 650],
    [-1, 200],
    [1200, 200],
    [200, -1],
    [200, 900],
  ])
    assert.strictEqual(outsideDeck(x!, y!, deck, viewport), false);
});
