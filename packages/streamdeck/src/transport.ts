export type Control = {
  type: 'button' | 'encoder' | 'lcd-segment';
  index: number;
  feedbackType?: 'none' | 'rgb' | 'lcd';
  pixelSize?: { width: number; height: number };
};

export type DeckEvent =
  | { kind: 'down' | 'up'; control: Control }
  | { kind: 'rotate'; control: Control; amount: number }
  | { kind: 'touch'; gesture: 'short' | 'long' | 'swipe'; control: Control; from: { x: number; y: number }; to?: { x: number; y: number } }
  | { kind: 'error'; error: unknown };

export type DeviceInfo = { path: string; model: string; controls: readonly Control[] };
export interface DeckTransport {
  readonly info: DeviceInfo;
  subscribe(listener: (event: DeckEvent) => void): () => void;
  paintKey(index: number, rgb: Uint8Array): Promise<void>;
  paintLcd(index: number, rgb: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export function selectDevice(devices: readonly DeviceInfo[], path?: string): DeviceInfo {
  if (path !== undefined) {
    const device = devices.find((item) => item.path === path);
    if (!device) throw new Error(`Appareil introuvable : ${path}. Relancer list après reconnexion.`);
    return device;
  }
  if (devices.length === 0) throw new Error('Aucun Stream Deck détecté. Brancher le câble USB, vérifier les permissions udev, puis relancer list. Le mode --mock --demo fonctionne sans appareil.');
  if (devices.length > 1) throw new Error('Plusieurs Stream Deck détectés. Choisir explicitement --path depuis list.');
  return devices[0]!;
}
