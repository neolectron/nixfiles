import { Context, Effect, Layer, Stream } from 'effect';
import type { ReactElement } from 'react';
import { StreamDeck } from './stream-deck.ts';
import { invalid } from './errors.ts';
import type { Position, Size } from './model.ts';
import * as Takumi from './takumi.ts';

/** Shared session renderer; each activation owns its feedback cache and controls. */
export const make = Effect.gen(function*() {
  const deck = yield* StreamDeck; const renderer = yield* Takumi.current;
  const frames = new Map<string, Uint8Array>();
  const write = (id: string, data: Uint8Array, effect: Effect.Effect<void, import('./errors.ts').StreamDeckError>) => Effect.suspend(() => {
    const before = frames.get(id);
    if (before?.length === data.length && before.every((value, index) => value === data[index])) return Effect.void;
    return effect.pipe(Effect.tap(() => Effect.sync(() => { frames.set(id, data.slice()); })));
  });
  const drawKey = (index: number, view: ReactElement) => Effect.gen(function*() {
      const size = deck.buttons.find((key) => key.index === index)?.pixelSize;
      if (!size) return yield* Effect.fail(invalid('display', 'This key is not an owned display.'));
      const image = yield* renderer.rgb(view, size);
      yield* write(`key/${index}`, image.data, deck.key(index).setImage(image));
    });
  const drawLcd = (index: number, view: ReactElement) => Effect.gen(function*() {
      const size = deck.lcds.find((lcd) => lcd.index === index)?.pixelSize;
      if (!size) return yield* Effect.fail(invalid('display', 'This LCD is not owned.'));
      const image = yield* renderer.rgb(view, size);
      yield* write(`lcd/${index}`, image.data, deck.lcd(index).setImage(image));
    });
  const drawRegion = (index: number, area: Position & Size, view: ReactElement) => Effect.gen(function*() {
      yield* deck.lcd(index).drawRegion(area, yield* renderer.rgb(view, area));
      frames.delete(`lcd/${index}`);
    });
  return { key: drawKey, lcd: drawLcd, region: drawRegion,
    watchKey: <A, E, R>(index: number, source: Stream.Stream<A, E, R>, view: (state: A, size: Size) => ReactElement, options: { readonly frameMillis?: number } = {}) => watch(source, (value) => drawKey(index, view(value, deck.buttons.find((key) => key.index === index)!.pixelSize!)), options),
    watchLcd: <A, E, R>(index: number, source: Stream.Stream<A, E, R>, view: (state: A, size: Size) => ReactElement, options: { readonly frameMillis?: number } = {}) => watch(source, (value) => drawLcd(index, view(value, deck.lcds.find((lcd) => lcd.index === index)!.pixelSize!)), options),
  };
});
export class DeckDisplay extends Context.Service<DeckDisplay, Effect.Success<typeof make>>()('@nixfiles/streamdeck/DeckDisplay') {
  static readonly layer = Layer.effect(DeckDisplay, make);
}

/** Visual state coalesces to the latest frame; command/event streams use Plugin.listen. */
const watch = <A, E, R, E2, R2>(source: Stream.Stream<A, E, R>, draw: (value: A) => Effect.Effect<void, E2, R2>, options: { readonly frameMillis?: number }) => Effect.gen(function*() {
  const interval = options.frameMillis ?? 40;
  if (!Number.isFinite(interval) || interval < 0 || interval > 10_000) return yield* Effect.fail(invalid('display', 'frameMillis must be in 0..10000.'));
  yield* Stream.runForEach(source.pipe(Stream.buffer({ capacity: 1, strategy: 'sliding' })), (state) => Effect.suspend(() => draw(state)).pipe(Effect.andThen(Effect.sleep(interval))));
});
