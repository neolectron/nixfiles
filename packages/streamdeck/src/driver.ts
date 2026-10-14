import { Context, Effect, type Scope } from 'effect';
import type { StreamDeckError } from './errors.ts';
import type { RgbImage } from './image.ts';
import type { DeckEvent, DeviceInfo, Position } from './model.ts';

/** Backend boundary. Scripts use StreamDeck, never native driver objects. */
export interface Connection {
  readonly info: DeviceInfo;
  readonly keyImage: (index: number, image: RgbImage) => Effect.Effect<void, StreamDeckError>;
  readonly lcdImage: (index: number, image: RgbImage) => Effect.Effect<void, StreamDeckError>;
  readonly lcdRegion: (
    index: number,
    position: Position,
    image: RgbImage,
  ) => Effect.Effect<void, StreamDeckError>;
  readonly brightness: (percent: number) => Effect.Effect<void, StreamDeckError>;
  readonly resetToLogo: Effect.Effect<void, StreamDeckError>;
  readonly firmwareVersion: Effect.Effect<string, StreamDeckError>;
  readonly serialNumber: Effect.Effect<string, StreamDeckError>;
}
export interface Observer {
  readonly event: (event: DeckEvent) => void;
  readonly error: (error: StreamDeckError) => void;
}
export class Driver extends Context.Service<
  Driver,
  {
    readonly list: Effect.Effect<ReadonlyArray<DeviceInfo>, StreamDeckError>;
    readonly open: (
      info: DeviceInfo,
      observer: Observer,
    ) => Effect.Effect<Connection, StreamDeckError, Scope.Scope>;
  }
>()('@nixfiles/streamdeck/Driver') {}
