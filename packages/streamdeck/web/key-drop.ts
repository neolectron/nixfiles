export interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}
/** Dropping between keys, on the LCD or on the bezel never means deletion. */
export const outsideDeck = (
  x: number,
  y: number,
  deck: Bounds,
  viewport: { width: number; height: number },
) =>
  x >= 0 &&
  y >= 0 &&
  x < viewport.width &&
  y < viewport.height &&
  (x < deck.left || x > deck.right || y < deck.top || y > deck.bottom);
