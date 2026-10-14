import { Context, Deferred, Effect, Layer, PubSub, Semaphore, Stream, type Scope } from 'effect';
import { Driver } from './driver.ts';
import { StreamDeckError, invalid, invariant } from './errors.ts';
import * as Image from './image.ts';
import type { Color, Control, DeckEvent, DeviceInfo, Position } from './model.ts';
export interface Key {
  readonly setImage: (image: Image.RgbImage) => Effect.Effect<void, StreamDeckError>;
  readonly label: (
    text: string,
    options?: Image.LabelOptions,
  ) => Effect.Effect<void, StreamDeckError>;
  readonly fill: (color: Color) => Effect.Effect<void, StreamDeckError>;
  readonly clear: Effect.Effect<void, StreamDeckError>;
}
export interface Lcd extends Key {
  readonly drawRegion: (
    position: Position,
    image: Image.RgbImage,
  ) => Effect.Effect<void, StreamDeckError>;
}
export interface Device {
  readonly info: DeviceInfo;
  readonly detectedModel?: Effect.Effect<string | null>;
  readonly connected?: Effect.Effect<boolean>;
  readonly connectionChanges?: import('effect').Stream.Stream<boolean>;
  readonly connectionError?: Effect.Effect<string | null>;
  readonly buttons: ReadonlyArray<Control>;
  readonly dials: ReadonlyArray<Control>;
  readonly lcds: ReadonlyArray<Control>;
  readonly key: (index: number) => Key;
  readonly lcd: (index: number) => Lcd;
  /** Live broadcast; independent subscriptions receive every event. No replay. */
  readonly events: Stream.Stream<DeckEvent, StreamDeckError>;
  /** Subscribe before starting a producer or painting initial feedback. */
  readonly subscribe: Effect.Effect<
    Stream.Stream<DeckEvent, StreamDeckError>,
    StreamDeckError,
    Scope.Scope
  >;
  readonly awaitFailure: Effect.Effect<never, StreamDeckError>;
  readonly setBrightness: (percent: number) => Effect.Effect<void, StreamDeckError>;
  readonly resetToLogo: Effect.Effect<void, StreamDeckError>;
  readonly firmwareVersion: Effect.Effect<string, StreamDeckError>;
  readonly serialNumber: Effect.Effect<string, StreamDeckError>;
}
export interface OpenOptions {
  readonly path?: string;
  readonly eventCapacity?: number;
}
export class StreamDeck extends Context.Service<StreamDeck, Device>()(
  '@nixfiles/streamdeck/StreamDeck',
) {
  static readonly layer = (options: OpenOptions = {}) => Layer.effect(StreamDeck, make(options));
}
export const discover = Effect.flatMap(Driver, (driver) => driver.list);
const select = (devices: ReadonlyArray<DeviceInfo>, path?: string) => {
  if (path !== undefined) {
    const device = devices.find((item) => item.path === path);
    return device
      ? Effect.succeed(device)
      : Effect.fail(
          new StreamDeckError({
            reason: 'NotFound',
            operation: 'select',
            path,
            message: 'Device path not found. Rediscover after reconnecting.',
          }),
        );
  }
  if (!devices.length)
    return Effect.fail(
      new StreamDeckError({
        reason: 'NotFound',
        operation: 'select',
        message: 'No Stream Deck found. Check USB connection and hidraw access.',
      }),
    );
  if (devices.length > 1)
    return Effect.fail(
      new StreamDeckError({
        reason: 'Ambiguous',
        operation: 'select',
        message: 'Multiple Stream Decks found. Select a path explicitly.',
      }),
    );
  return Effect.succeed(invariant(devices[0], 'stream-deck'));
};
const make = (options: OpenOptions) =>
  Effect.gen(function* () {
    const capacity = options.eventCapacity ?? 256;
    if (!Number.isSafeInteger(capacity) || capacity <= 0 || capacity > 65536)
      return yield* Effect.fail(invalid('open', 'eventCapacity must be an integer in 1..65536.'));
    const driver = yield* Driver;
    const selected = yield* select(yield* driver.list, options.path);
    const hub = yield* Effect.acquireRelease(PubSub.bounded<DeckEvent>(capacity), PubSub.shutdown);
    const terminal = yield* Deferred.make<never, StreamDeckError>();
    const semaphore = yield* Semaphore.make(1);
    let closed = false;
    const fail = (error: StreamDeckError) => {
      Deferred.doneUnsafe(terminal, Effect.fail(error));
    };
    const connection = yield* driver.open(selected, {
      error: fail,
      event: (event) => {
        if (closed || Deferred.isDoneUnsafe(terminal)) return;
        if (!PubSub.publishUnsafe(hub, event))
          fail(
            new StreamDeckError({
              reason: 'Overflow',
              operation: 'events',
              path: selected.path,
              message: `Event buffer (${capacity}) full. A slow subscriber cannot keep up; stopping rather than losing input silently.`,
            }),
          );
      },
    });
    // LIFO finalization: mark closed first, close driver next, then shut down hub.
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true;
        fail(
          new StreamDeckError({
            reason: 'Closed',
            operation: 'scope',
            path: selected.path,
            message: 'Device scope is closed.',
          }),
        );
      }),
    );
    const awaitFailure = Deferred.await(terminal);
    const subscribe = Effect.gen(function* () {
      if (closed || (yield* Deferred.isDone(terminal))) return yield* awaitFailure;
      const subscription = yield* PubSub.subscribe(hub);
      return Stream.fromEffectRepeat(Effect.raceFirst(PubSub.take(subscription), awaitFailure));
    });
    const wire = <A>(
      effect: Effect.Effect<A, StreamDeckError>,
    ): Effect.Effect<A, StreamDeckError> =>
      Semaphore.withPermits(
        semaphore,
        1,
      )(
        Effect.gen(function* () {
          if (closed)
            return yield* Effect.fail(
              new StreamDeckError({
                reason: 'Closed',
                operation: 'device',
                message: 'Device scope is closed.',
              }),
            );
          if (yield* Deferred.isDone(terminal)) return yield* awaitFailure;
          // Native promises cannot be cancelled: keep the permit until completion.
          return yield* effect.pipe(
            Effect.tapError((error) => Deferred.fail(terminal, error)),
            Effect.uninterruptible,
          );
        }),
      );
    const requireControl = (type: Control['type'], index: number) =>
      Effect.suspend(() => {
        const control = connection.info.controls.find(
          (item) => item.type === type && item.index === index,
        );
        if (!control)
          return Effect.fail(
            invalid('control', `No ${type} at index ${index} on ${connection.info.model}.`),
          );
        if (!control.pixelSize || (type === 'button' && control.feedbackType !== 'lcd'))
          return Effect.fail(
            new StreamDeckError({
              reason: 'Unsupported',
              operation: 'display',
              message: `Control ${index} has no LCD feedback.`,
            }),
          );
        return Effect.succeed({ control, size: control.pixelSize });
      });
    const display = (type: 'button' | 'lcd-segment', index: number): Key => {
      const setImage = (image: Image.RgbImage) =>
        Effect.gen(function* () {
          const { size } = yield* requireControl(type, index);
          if (!Image.validate(image) || image.width !== size.width || image.height !== size.height)
            return yield* Effect.fail(
              invalid('image', `Expected RGB ${size.width}x${size.height} for ${type} ${index}.`),
            );
          const snapshot = { ...image, data: image.data.slice() };
          yield* wire(
            type === 'button'
              ? connection.keyImage(index, snapshot)
              : connection.lcdImage(index, snapshot),
          );
        });
      const fill = (color: Color) =>
        Effect.gen(function* () {
          const { size } = yield* requireControl(type, index);
          yield* setImage(yield* Image.solid(size, color));
        });
      return {
        setImage,
        fill,
        clear: fill([0, 0, 0]),
        label: (text, currentOptions) =>
          Effect.gen(function* () {
            const { size } = yield* requireControl(type, index);
            yield* setImage(yield* Image.label(size, text, currentOptions));
          }),
      };
    };
    return StreamDeck.of({
      info: connection.info,
      ...(connection.detectedModel ? { detectedModel: connection.detectedModel } : {}),
      connected: connection.connected ?? Effect.succeed(true),
      ...(connection.connectionChanges ? { connectionChanges: connection.connectionChanges } : {}),
      connectionError: connection.connectionError ?? Effect.succeed(null),
      buttons: connection.info.controls.filter((control) => control.type === 'button'),
      dials: connection.info.controls.filter((control) => control.type === 'encoder'),
      lcds: connection.info.controls.filter((control) => control.type === 'lcd-segment'),
      key: (index) => display('button', index),
      lcd: (index) => ({
        ...display('lcd-segment', index),
        drawRegion: (position, image) =>
          Effect.gen(function* () {
            const { size } = yield* requireControl('lcd-segment', index);
            if (
              !Image.validate(image) ||
              !Number.isSafeInteger(position.x) ||
              !Number.isSafeInteger(position.y) ||
              position.x < 0 ||
              position.y < 0 ||
              position.x + image.width > size.width ||
              position.y + image.height > size.height
            ) {
              return yield* Effect.fail(
                invalid('region', 'RGB region must fit inside the logical LCD bounds.'),
              );
            }
            yield* wire(
              connection.lcdRegion(index, { ...position }, { ...image, data: image.data.slice() }),
            );
          }),
      }),
      events: Stream.unwrap(subscribe),
      subscribe,
      awaitFailure,
      setBrightness: (percent) =>
        Number.isInteger(percent) && percent >= 0 && percent <= 100
          ? wire(connection.brightness(percent))
          : Effect.fail(invalid('brightness', 'Brightness must be an integer in 0..100.')),
      resetToLogo: wire(connection.resetToLogo),
      firmwareVersion: wire(connection.firmwareVersion),
      serialNumber: wire(connection.serialNumber),
    });
  });
