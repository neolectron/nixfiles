import type { Control, DeckEvent, DeckTransport, DeviceInfo } from './transport.js';

export const mockButton: Control = { type: 'button', index: 0, feedbackType: 'lcd', pixelSize: { width: 120, height: 120 } };
export const mockEncoder: Control = { type: 'encoder', index: 0 };
export const mockInfo: DeviceInfo = {
  path: 'mock://streamdeck-plus', model: 'Mock Stream Deck + (8 touches, 4 potards)',
  controls: [
    ...Array.from({ length: 8 }, (_, index) => ({ ...mockButton, index })),
    ...Array.from({ length: 4 }, (_, index) => ({ ...mockEncoder, index })),
    { type: 'lcd-segment', index: 0, pixelSize: { width: 800, height: 100 } },
  ],
};

export class MockDeck implements DeckTransport {
  readonly info: DeviceInfo;
  readonly frames: { index: number; rgb: Uint8Array }[] = [];
  closed = false;
  private listeners = new Set<(event: DeckEvent) => void>();
  constructor(info: DeviceInfo = mockInfo) { this.info = info; }
  subscribe(listener: (event: DeckEvent) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  emit(event: DeckEvent) {
    if (this.closed) throw new Error('Mock fermé');
    for (const listener of this.listeners) listener(event);
  }
  async paintKey(index: number, rgb: Uint8Array) {
    if (this.closed) throw new Error('Mock fermé');
    const key = this.info.controls.find((control) => control.type === 'button' && control.index === index);
    if (!key?.pixelSize || rgb.length !== key.pixelSize.width * key.pixelSize.height * 3) throw new Error('Trame RGB incorrecte');
    this.frames.push({ index, rgb: rgb.slice() });
  }
  async close() { this.closed = true; this.listeners.clear(); }
}

export const demoEvents: readonly DeckEvent[] = [
  { kind: 'down', control: mockButton }, { kind: 'up', control: mockButton },
  { kind: 'down', control: mockEncoder }, { kind: 'up', control: mockEncoder },
  { kind: 'rotate', control: mockEncoder, amount: 3 },
  { kind: 'rotate', control: mockEncoder, amount: -2 },
  { kind: 'touch', gesture: 'short', control: mockInfo.controls[12]!, from: { x: 42, y: 25 } },
];
