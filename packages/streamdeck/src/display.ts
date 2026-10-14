import { Context, Effect, Layer } from 'effect';
import type { ReactElement } from 'react';
import { StreamDeck } from './stream-deck.ts';
import { invalid } from './errors.ts';
import type { Position, Size } from './model.ts';
import * as Takumi from './takumi.ts';

/** One renderer per plugin activation; dimensions come from the claimed device controls. */
export const make = Effect.gen(function*() {
  const deck = yield* StreamDeck; const renderer = yield* Takumi.make;
  return {
    key: (index: number, view: ReactElement) => Effect.gen(function*() {
      const size = deck.buttons.find((key) => key.index === index)?.pixelSize;
      if (!size) return yield* Effect.fail(invalid('display', 'This key is not an owned display.'));
      yield* deck.key(index).setImage(yield* renderer.rgb(view, size));
    }),
    lcd: (index: number, view: ReactElement) => Effect.gen(function*() {
      const size = deck.lcds.find((lcd) => lcd.index === index)?.pixelSize;
      if (!size) return yield* Effect.fail(invalid('display', 'This LCD is not owned.'));
      yield* deck.lcd(index).setImage(yield* renderer.rgb(view, size));
    }),
    region: (index: number, area: Position & Size, view: ReactElement) => Effect.gen(function*() {
      yield* deck.lcd(index).drawRegion(area, yield* renderer.rgb(view, area));
    }),
  };
});
export class DeckDisplay extends Context.Service<DeckDisplay, Effect.Success<typeof make>>()('@nixfiles/streamdeck/DeckDisplay') {
  static readonly layer = Layer.effect(DeckDisplay, make);
}
