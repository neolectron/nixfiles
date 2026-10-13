import { Effect, Layer } from 'effect';
import type { StreamDeck as NativeDeck, StreamDeckModelInfo } from '@elgato-stream-deck/node';
import { Driver, type Connection } from './driver.ts';
import { StreamDeckError } from './errors.ts';
import type { DeviceInfo } from './model.ts';
import { StreamDeck, type OpenOptions } from './stream-deck.ts';

const error = (operation: string, cause: unknown, path?: string) => new StreamDeckError({
  reason: 'Driver', operation, ...(path === undefined ? {} : { path }), cause,
  message: `${operation}: ${cause instanceof Error ? cause.message : String(cause)}`,
});
const native = <A>(operation: string, f: () => Promise<A>, path?: string) => Effect.tryPromise({ try: f, catch: (cause) => error(operation, cause, path) });
const describe = (path: string, model: StreamDeckModelInfo, usb: { vendorId: number; productId: number }): DeviceInfo => ({
  path, model: model.name, ...usb,
  controls: model.controls.map((control) => ({
    type: control.type, index: control.index, row: control.row, column: control.column,
    bounds: { ...control.bounds },
    ...('feedbackType' in control ? { feedbackType: control.feedbackType } : {}),
    ...('pixelSize' in control ? { pixelSize: { ...control.pixelSize } } : {}),
  })),
});
// Type-only imports above do not load node-hid. Mock scripts never load native code.
const module = () => native('load HID driver', () => import('@elgato-stream-deck/node'));
// Process-local ownership only; this cannot detect another application using HID.
const claimedPaths = new Set<string>();

export const driverLayer = Layer.succeed(Driver, Driver.of({
  list: Effect.gen(function*() {
    const hid = yield* module();
    const nodeHid = yield* native('load enumeration', () => import('node-hid'));
    const devices = yield* native('discover', () => nodeHid.devicesAsync());
    return devices.flatMap((device) => {
      const supported = hid.getStreamDeckDeviceInfo(device);
      return supported ? [describe(supported.path, supported.modelInfo, { vendorId: device.vendorId, productId: device.productId })] : [];
    }).filter((device, index, all) => all.findIndex((other) => other.path === device.path) === index);
  }),
  open: (info, observer) => Effect.gen(function*() {
    yield* Effect.acquireRelease(Effect.suspend(() => {
      if (claimedPaths.has(info.path)) return Effect.fail(new StreamDeckError({ reason: 'AlreadyOpen', operation: 'open', path: info.path, message: 'This process already owns this device. Share its StreamDeck layer.' }));
      claimedPaths.add(info.path);
      return Effect.succeed(info.path);
    }), (path) => Effect.sync(() => { claimedPaths.delete(path); }));
    const hid = yield* module();
    const deck: NativeDeck = yield* Effect.acquireRelease(
      native('open', () => hid.openStreamDeck(info.path, { resetToLogoOnClose: false }), info.path),
      (handle) => native('close', () => handle.close(), info.path).pipe(
        Effect.orDie,
        Effect.ensuring(Effect.sync(() => handle.removeAllListeners())),
      ),
    );
    // Attach error handling immediately; early errors reach the persistent Deferred.
    deck.on('error', (cause) => observer.error(error('input', cause, info.path)));
    deck.on('down', (control) => observer.event(control.type === 'button'
      ? { _tag: 'KeyDown', key: control.index } : { _tag: 'DialDown', dial: control.index }));
    deck.on('up', (control) => observer.event(control.type === 'button'
      ? { _tag: 'KeyUp', key: control.index } : { _tag: 'DialUp', dial: control.index }));
    deck.on('rotate', (control, delta) => observer.event({ _tag: 'DialRotate', dial: control.index, delta }));
    deck.on('lcdShortPress', (control, position) => observer.event({ _tag: 'TouchTap', lcd: control.index, position: { ...position } }));
    deck.on('lcdLongPress', (control, position) => observer.event({ _tag: 'TouchHold', lcd: control.index, position: { ...position } }));
    deck.on('lcdSwipe', (control, from, to) => observer.event({ _tag: 'TouchSwipe', lcd: control.index, from: { ...from }, to: { ...to } }));
    const identity = yield* native('USB identity', () => deck.getHidDeviceInfo(), info.path);
    const lcdId = (index: number) => deck.modelInfo.controls.find((control) => control.type === 'lcd-segment' && control.index === index)!.id as number;
    return {
      info: describe(info.path, deck.modelInfo, { vendorId: identity.vendorId, productId: identity.productId }),
      keyImage: (index, image) => native('key image', () => deck.fillKeyBuffer(index, image.data, { format: 'rgb' }), info.path),
      lcdImage: (index, image) => native('LCD image', () => deck.fillLcd(lcdId(index), image.data, { format: 'rgb' }), info.path),
      lcdRegion: (index, position, image) => native('LCD region', () => deck.fillLcdRegion(lcdId(index), position.x, position.y, image.data, { format: 'rgb', width: image.width, height: image.height }), info.path),
      brightness: (percent) => native('brightness', () => deck.setBrightness(percent), info.path),
      resetToLogo: native('reset to logo', () => deck.resetToLogo(), info.path),
      firmwareVersion: native('firmware version', () => deck.getFirmwareVersion(), info.path),
      serialNumber: native('serial number', () => deck.getSerialNumber(), info.path),
    } satisfies Connection;
  }),
}));

export const layer = (options: OpenOptions = {}) => StreamDeck.layer(options).pipe(Layer.provide(driverLayer));
