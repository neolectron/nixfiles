import { Effect, Layer } from 'effect';
import { Driver, type Connection, type Observer } from './driver.js';
import { StreamDeckError } from './errors.js';
import type { RgbImage } from './image.js';
import type { DeckEvent, DeviceInfo, Position } from './model.js';
import { StreamDeck, type OpenOptions } from './stream-deck.js';

export const plusXl: DeviceInfo = {
  path: 'mock://plus-xl', model: 'Mock Stream Deck + XL', vendorId: 0x0fd9, productId: 0x00c6,
  controls: [
    ...Array.from({ length: 36 }, (_, index) => ({ type: 'button' as const, index, row: Math.floor(index / 9), column: index % 9, feedbackType: 'lcd' as const, pixelSize: { width: 112, height: 112 } })),
    ...Array.from({ length: 6 }, (_, index) => ({ type: 'encoder' as const, index })),
    { type: 'lcd-segment', index: 0, pixelSize: { width: 1200, height: 100 } },
  ],
};
export type Write =
  | { readonly kind: 'key' | 'lcd'; readonly index: number; readonly image: RgbImage }
  | { readonly kind: 'region'; readonly index: number; readonly position: Position; readonly image: RgbImage }
  | { readonly kind: 'brightness'; readonly percent: number }
  | { readonly kind: 'logo' };
export interface MockOptions {
  readonly devices?: ReadonlyArray<DeviceInfo>;
  readonly onWrite?: (write: Write) => Effect.Effect<void, StreamDeckError>;
  readonly onOpen?: (observer: Observer) => void;
}

/** Fresh controller per test; no native module or global mock singleton. */
export const make = (options: MockOptions = {}) => {
  const devices = options.devices ?? [plusXl];
  const writes: Write[] = [];
  const listeners = new Map<string, Observer>();
  let opens = 0;
  let closes = 0;
  const driverLayer = Layer.succeed(Driver, Driver.of({
    list: Effect.succeed(devices),
    open: (info, observer) => Effect.gen(function*() {
      yield* Effect.acquireRelease(Effect.suspend(() => {
        if (listeners.has(info.path)) return Effect.fail(new StreamDeckError({ reason: 'AlreadyOpen', operation: 'mock open', message: 'This mock path is already open.' }));
        listeners.set(info.path, observer); opens++;
        return Effect.succeed(info);
      }), (device) => Effect.sync(() => { listeners.delete(device.path); closes++; }));
      if (options.onOpen) yield* Effect.sync(() => options.onOpen!(observer));
      const write = (command: Write) => Effect.gen(function*() {
        if (options.onWrite) yield* options.onWrite(command);
        yield* Effect.sync(() => writes.push(command));
      });
      return {
        info,
        keyImage: (index, image) => write({ kind: 'key', index, image }),
        lcdImage: (index, image) => write({ kind: 'lcd', index, image }),
        lcdRegion: (index, position, image) => write({ kind: 'region', index, position, image }),
        brightness: (percent) => write({ kind: 'brightness', percent }),
        resetToLogo: write({ kind: 'logo' }), firmwareVersion: Effect.succeed('mock-fw'), serialNumber: Effect.succeed('mock-serial'),
      } satisfies Connection;
    }),
  }));
  return {
    driverLayer,
    layer: (openOptions: OpenOptions = {}) => StreamDeck.layer(openOptions).pipe(Layer.provide(driverLayer)),
    writes: writes as ReadonlyArray<Write>,
    get opens() { return opens; }, get closes() { return closes; },
    emit: (event: DeckEvent, path = devices[0]?.path) => Effect.sync(() => { if (path) listeners.get(path)?.event(event); }),
    disconnect: (path = devices[0]?.path) => Effect.sync(() => { if (path) listeners.get(path)?.error(new StreamDeckError({ reason: 'Driver', operation: 'mock disconnect', message: 'Mock USB disconnected.', path })); }),
  };
};
export const demoEvents: ReadonlyArray<DeckEvent> = [
  { _tag: 'KeyDown', key: 0 }, { _tag: 'KeyUp', key: 0 },
  { _tag: 'DialDown', dial: 0 }, { _tag: 'DialUp', dial: 0 },
  { _tag: 'DialRotate', dial: 0, delta: 3 }, { _tag: 'DialRotate', dial: 0, delta: -2 },
  { _tag: 'TouchTap', lcd: 0, position: { x: 42, y: 25 } },
];
