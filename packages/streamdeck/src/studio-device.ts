import { Effect, Layer, Semaphore, Stream } from 'effect';
import { Driver, type Connection } from './driver.ts';
import { DeckConnection } from './deck-connection.ts';
import { StreamDeckError, invariant } from './errors.ts';
import type { RgbImage } from './image.ts';
import { StreamDeck, type OpenOptions } from './stream-deck.ts';

const metadataError = (cause: unknown) =>
  new StreamDeckError({
    reason: 'NotFound',
    operation: 'USB metadata',
    message: 'Stream Deck déconnecté.',
    cause,
  });

/** Studio output boundary: preserve its canvas and handle only the expected DeckOffline error. */
export const driverLayer = Layer.effect(
  Driver,
  Effect.gen(function* () {
    const connection = yield* DeckConnection;
    return Driver.of({
      list: Effect.succeed([connection.info]),
      open: (_, observer) =>
        Effect.gen(function* () {
          const lock = yield* Semaphore.make(1);
          const frames = new Map<string, { kind: 'key' | 'lcd'; index: number; image: RgbImage }>();
          let brightness: number | undefined;
          const send = (write: (current: Connection) => Effect.Effect<void, StreamDeckError>) =>
            connection.use(write).pipe(Effect.catchTag('DeckOffline', () => Effect.void));
          const image = (kind: 'key' | 'lcd', index: number, current: RgbImage) =>
            Semaphore.withPermits(
              lock,
              1,
            )(
              Effect.gen(function* () {
                frames.set(`${kind}/${index}`, {
                  kind,
                  index,
                  image: { ...current, data: current.data.slice() },
                });
                yield* send((deck) =>
                  kind === 'key' ? deck.keyImage(index, current) : deck.lcdImage(index, current),
                );
              }),
            );
          // Connection's own lock serializes restoration and writes. No reverse acquisition of the canvas lock.
          yield* connection.onConnect((opened) =>
            Effect.gen(function* () {
              if (brightness !== undefined) yield* opened.brightness(brightness);
              for (const frame of frames.values())
                yield* frame.kind === 'key'
                  ? opened.keyImage(frame.index, frame.image)
                  : opened.lcdImage(frame.index, frame.image);
            }),
          );
          yield* Effect.forkScoped(
            Stream.runForEach(yield* connection.subscribe, (event) =>
              Effect.sync(() => observer.event(event)),
            ),
          );
          return {
            info: connection.info,
            detectedModel: connection.detectedModel,
            connected: connection.connected,
            connectionChanges: connection.changes,
            connectionError: Effect.map(connection.error, (error) => error?.message ?? null),
            keyImage: (index, current) => image('key', index, current),
            lcdImage: (index, current) => image('lcd', index, current),
            lcdRegion: (index, position, region) =>
              Semaphore.withPermits(
                lock,
                1,
              )(
                Effect.gen(function* () {
                  const size = invariant(
                    connection.info.controls.find(
                      (control) => control.type === 'lcd-segment' && control.index === index,
                    )?.pixelSize,
                    'studio LCD',
                  );
                  const data =
                    frames.get(`lcd/${index}`)?.image.data.slice() ??
                    new Uint8Array(size.width * size.height * 3);
                  for (let row = 0; row < region.height; row++)
                    data.set(
                      region.data.subarray(row * region.width * 3, (row + 1) * region.width * 3),
                      ((position.y + row) * size.width + position.x) * 3,
                    );
                  frames.set(`lcd/${index}`, { kind: 'lcd', index, image: { ...size, data } });
                  yield* send((deck) => deck.lcdRegion(index, position, region));
                }),
              ),
            brightness: (percent) =>
              Semaphore.withPermits(
                lock,
                1,
              )(
                Effect.gen(function* () {
                  brightness = percent;
                  yield* send((deck) => deck.brightness(percent));
                }),
              ),
            resetToLogo: Semaphore.withPermits(
              lock,
              1,
            )(
              Effect.gen(function* () {
                frames.clear();
                yield* send((deck) => deck.resetToLogo);
              }),
            ),
            firmwareVersion: connection
              .use((deck) => deck.firmwareVersion)
              .pipe(Effect.mapError(metadataError)),
            serialNumber: connection
              .use((deck) => deck.serialNumber)
              .pipe(Effect.mapError(metadataError)),
          } satisfies Connection;
        }),
    });
  }),
);
export const layer = (options: OpenOptions = {}) =>
  StreamDeck.layer().pipe(
    Layer.provide(driverLayer.pipe(Layer.provide(DeckConnection.layer(options)))),
  );
