import type { StreamDeck, StreamDeckButtonControlDefinition, StreamDeckEncoderControlDefinition, StreamDeckLcdSegmentControlDefinition, LcdPosition } from '@elgato-stream-deck/node';
import type { DeckTransport, DeckEvent, DeviceInfo } from './transport.js';

// No native module loads in mock mode. Use the library's v7 control objects,
// not the numeric key event signature found in its older README examples.
export async function listHardware(): Promise<DeviceInfo[]> {
  const { listStreamDecks } = await import('@elgato-stream-deck/node');
  return (await listStreamDecks()).map((device) => ({
    path: device.path, model: device.modelInfo.name, controls: device.modelInfo.controls,
  }));
}

export async function openHardware(info: DeviceInfo): Promise<DeckTransport> {
  const { openStreamDeck } = await import('@elgato-stream-deck/node');
  const deck: StreamDeck = await openStreamDeck(info.path, { resetToLogoOnClose: false });
  const listeners = new Set<(event: DeckEvent) => void>();
  const emit = (event: DeckEvent) => { for (const listener of listeners) listener(event); };
  // Installed immediately, including before the hello session subscribes.
  let pendingError: unknown;
  let hasPendingError = false;
  deck.on('error', (error: unknown) => {
    if (!listeners.size) { pendingError = error; hasPendingError = true; }
    emit({ kind: 'error', error });
  });
  type Input = StreamDeckButtonControlDefinition | StreamDeckEncoderControlDefinition;
  deck.on('down', (control: Input) => emit({ kind: 'down', control }));
  deck.on('up', (control: Input) => emit({ kind: 'up', control }));
  deck.on('rotate', (control: StreamDeckEncoderControlDefinition, amount: number) => emit({ kind: 'rotate', control, amount }));
  deck.on('lcdShortPress', (control: StreamDeckLcdSegmentControlDefinition, from: LcdPosition) => emit({ kind: 'touch', gesture: 'short', control, from }));
  deck.on('lcdLongPress', (control: StreamDeckLcdSegmentControlDefinition, from: LcdPosition) => emit({ kind: 'touch', gesture: 'long', control, from }));
  deck.on('lcdSwipe', (control: StreamDeckLcdSegmentControlDefinition, from: LcdPosition, to: LcdPosition) => emit({ kind: 'touch', gesture: 'swipe', control, from, to }));
  return {
    info: { path: info.path, model: deck.modelInfo.name, controls: deck.modelInfo.controls },
    subscribe(listener) {
      listeners.add(listener);
      if (hasPendingError) listener({ kind: 'error', error: pendingError });
      return () => { listeners.delete(listener); };
    },
    async paintKey(index, rgb) { await deck.fillKeyBuffer(index, rgb, { format: 'rgb' }); },
    async paintLcd(index, rgb) { await deck.fillLcd(index, rgb, { format: 'rgb' }); },
    async close() { await deck.close(); listeners.clear(); },
  };
}
