import { Schema } from 'effect';
import * as Layout from '../src/lcd-layout.ts';
import type { Catalogue } from '../src/studio-contract.ts';
import { supports } from '../src/tile-capabilities.ts';
/** Drop and append share the same pure edit; a virtual strip can grow beyond its viewport. */
export const insert = (
  before: Layout.Configuration,
  navigation: Layout.Navigation,
  action: Catalogue['pluginActions'][number],
  lcd: { index: number; width: number },
  x: number,
  ids: { tile: string; zone: string },
  append = false,
) => {
  if (!supports(action, 'lcd'))
    throw new Error('Cette action nécessite une touche physique avec relâchement.');
  const config = structuredClone(before) as {
    zones: Array<Layout.Configuration['zones'][number]>;
    folders: Array<Layout.Configuration['folders'][number]>;
  };
  let zone = config.zones.find(
    (entry) => entry.lcd === lcd.index && x >= entry.x && x < entry.x + entry.width,
  );
  const width = Math.min(action.tile?.width ?? 160, lcd.width);
  if (!zone) {
    const neighbors = config.zones.filter((entry) => entry.lcd === lcd.index);
    const left = Math.max(
      0,
      ...neighbors
        .filter((entry) => entry.x + entry.width <= x)
        .map((entry) => entry.x + entry.width),
    );
    const right = Math.min(
      lcd.width,
      ...neighbors.filter((entry) => entry.x >= x).map((entry) => entry.x),
    );
    if (right - left < 40) throw new Error('Pas assez de place pour une zone LCD ici.');
    const available = Math.min(width, right - left);
    const start = Math.max(left, Math.min(right - available, Math.round(x / 100) * 100));
    zone = {
      id: ids.zone,
      name: `Zone LCD ${config.zones.length + 1}`,
      lcd: lcd.index,
      x: start,
      width: available,
      application: '',
      pages: [[]],
    };
    config.zones.push(zone);
  }
  const position = navigation[zone.id] ?? Layout.root;
  const content = Layout.container(config, zone, position.folder);
  const items = content.pages[Math.min(position.page, content.pages.length - 1)] as Layout.Tile[];
  let at = items.length;
  if (!append) {
    let cursor = -(position.offset ?? 0) + (position.folder ? 100 : 0);
    at = items.findIndex((tile) => {
      const center = cursor + tile.width / 2;
      cursor += tile.width;
      return x - zone.x < center;
    });
    if (at < 0) at = items.length;
  }
  const tile = {
    id: ids.tile,
    plugin: action.plugin,
    action: action.id,
    input: Schema.decodeUnknownSync(Schema.Json)(action.defaults),
    label: action.tile?.label ?? action.name,
    width,
    application: '',
  };
  items.splice(at, 0, tile);
  Layout.validate(config, [lcd]);
  return { config, tile, zone: zone.id };
};
