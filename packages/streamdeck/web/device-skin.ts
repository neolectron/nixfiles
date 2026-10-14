export type DeviceSkin =
  | 'plus-xl'
  | 'plus'
  | 'xl'
  | 'mini'
  | 'neo'
  | 'studio'
  | 'standard'
  | 'generic';
export const deviceName = (model: string | undefined) =>
  model?.replace(/^Mock /, '') ?? 'Stream Deck';
/** Select a known casing by reported model, never by an assumed key count. */
export const deviceSkin = (model: string | undefined): DeviceSkin => {
  if (model === undefined) return 'generic';
  switch (deviceName(model)) {
    case 'Stream Deck + XL':
      return 'plus-xl';
    case 'Stream Deck +':
      return 'plus';
    case 'Stream Deck XL':
      return 'xl';
    case 'Stream Deck Mini':
      return 'mini';
    case 'Stream Deck Neo':
      return 'neo';
    case 'Stream Deck Studio':
      return 'studio';
    case 'Stream Deck Original':
    case 'Stream Deck':
    case 'Stream Deck MK.2 (Scissor)':
    case 'Stream Deck MK.2':
      return 'standard';
    default:
      return 'generic';
  }
};
