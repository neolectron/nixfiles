import { Context, type Effect } from 'effect';
import type { Position, Size } from './model.ts';

export type Region = Position & Size;

/** A base region keeps its position; expansion stops at the first foreground claim. */
export const expansionWidth = (
  anchor: Region,
  requested: number,
  occupied: ReadonlyArray<Region>,
): number => {
  let right = anchor.x + Math.max(anchor.width, requested);
  for (const region of occupied)
    if (
      region.y < anchor.y + anchor.height &&
      anchor.y < region.y + region.height &&
      region.x + region.width > anchor.x &&
      region.x < right
    )
      right = Math.min(right, region.x);
  return Math.max(anchor.width, right - anchor.x);
};

/** Shared LCD geometry, supplied by the compositor rather than individual plugins. */
export class LcdSpace extends Context.Service<
  LcdSpace,
  {
    readonly expand: (lcd: number, anchor: Region, requested: number) => Effect.Effect<number>;
  }
>()('@nixfiles/streamdeck/LcdSpace') {}
