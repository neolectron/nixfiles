import { Effect, Ref, Semaphore } from 'effect';
import { encode } from 'fast-png';
import * as Image from './image.ts';
import type { Position } from './model.ts';
import { StreamDeckError, invariant } from './errors.ts';
import { StreamDeck, type Device, type Key } from './stream-deck.ts';
interface Frame {
  readonly image: Image.RgbImage;
  readonly revision: number;
}
/** Mirror successful logical writes; there is no HID image readback. */
export const make = (deck: Device) =>
  Effect.gen(function* () {
    const frames = yield* Ref.make<ReadonlyMap<string, Frame>>(new Map());
    const lock = yield* Semaphore.make(1);
    const pngCache = new Map<
      string,
      {
        revision: number;
        bytes: Uint8Array;
      }
    >();
    const remember = (id: string, image: Image.RgbImage) =>
      Ref.update(frames, (previous) => {
        const next = new Map(previous);
        next.set(id, {
          image: { ...image, data: image.data.slice() },
          revision: (previous.get(id)?.revision ?? 0) + 1,
        });
        return next;
      });
    const display = (kind: 'key' | 'lcd', index: number, original: Key): Key => {
      const id = `${kind}/${index}`;
      const setImage = (image: Image.RgbImage) =>
        Semaphore.withPermits(
          lock,
          1,
        )(original.setImage(image).pipe(Effect.andThen(remember(id, image))));
      const size = (kind === 'key' ? deck.buttons : deck.lcds).find(
        (control) => control.index === index,
      )?.pixelSize;
      const fill = (color: import('./model.ts').Color) =>
        size ? Effect.flatMap(Image.solid(size, color), setImage) : original.fill(color);
      return {
        setImage,
        fill,
        clear: fill([0, 0, 0]),
        label: (text, options) =>
          size
            ? Effect.flatMap(Image.label(size, text, options), setImage)
            : original.label(text, options),
      };
    };
    const device = StreamDeck.of({
      ...deck,
      key: (index) => display('key', index, deck.key(index)),
      lcd: (index) => ({
        ...display('lcd', index, deck.lcd(index)),
        drawRegion: (position: Position, image: Image.RgbImage) =>
          Semaphore.withPermits(
            lock,
            1,
          )(
            Effect.gen(function* () {
              yield* deck.lcd(index).drawRegion(position, image);
              const id = `lcd/${index}`;
              const previous = (yield* Ref.get(frames)).get(id);
              const size = invariant(
                invariant(
                  deck.lcds.find((lcd) => lcd.index === index),
                  'deck-preview',
                ).pixelSize,
                'deck-preview',
              );
              const data =
                previous?.image.data.slice() ?? new Uint8Array(size.width * size.height * 3);
              for (let row = 0; row < image.height; row++)
                data.set(
                  image.data.subarray(row * image.width * 3, (row + 1) * image.width * 3),
                  ((position.y + row) * size.width + position.x) * 3,
                );
              yield* remember(id, { ...size, data });
            }),
          ),
      }),
      resetToLogo: deck.resetToLogo.pipe(
        Effect.andThen(Ref.set(frames, new Map())),
        Effect.andThen(Effect.sync(() => pngCache.clear())),
      ),
    });
    return {
      device,
      frames: Ref.get(frames),
      png: (kind: 'key' | 'lcd', index: number) =>
        Effect.gen(function* () {
          const id = `${kind}/${index}`;
          const frame = (yield* Ref.get(frames)).get(id);
          if (!frame)
            return yield* Effect.fail(
              new StreamDeckError({
                reason: 'NotFound',
                operation: 'preview',
                message: 'No image has been sent to this control.',
              }),
            );
          const cached = pngCache.get(id);
          if (cached?.revision === frame.revision) return cached.bytes;
          const bytes = yield* Effect.try({
            try: () => encode({ ...frame.image, channels: 3, depth: 8 }),
            catch: (cause) =>
              new StreamDeckError({
                reason: 'Driver',
                operation: 'preview PNG',
                message: 'Could not encode the preview.',
                cause,
              }),
          });
          pngCache.set(id, { revision: frame.revision, bytes });
          return bytes;
        }),
    };
  });
