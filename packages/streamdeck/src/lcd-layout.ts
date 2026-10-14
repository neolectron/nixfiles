import { Schema } from 'effect';

const id = Schema.NonEmptyString.check(Schema.isMaxLength(80));
const width = Schema.Int.check(Schema.isBetween({ minimum: 40, maximum: 8192 }));
export const Tile = Schema.Struct({
  id,
  plugin: id,
  action: id,
  input: Schema.Json,
  label: Schema.String.check(Schema.isMaxLength(80)),
  width,
  /** Empty means any focused application. Matched against the exact desktop app_id. */
  application: Schema.String.check(Schema.isMaxLength(256)),
});
export type Tile = typeof Tile.Type;
const pageList = Schema.Array(Schema.Array(Tile).check(Schema.isMaxLength(256))).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(64),
);
export const Configuration = Schema.Struct({
  zones: Schema.Array(
    Schema.Struct({
      id,
      name: id,
      lcd: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 31 })),
      x: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 8192 })),
      width,
      application: Schema.String.check(Schema.isMaxLength(256)),
      pages: pageList,
    }),
  ).check(Schema.isMaxLength(32)),
  folders: Schema.Array(Schema.Struct({ id, name: id, pages: pageList })).check(
    Schema.isMaxLength(128),
  ),
});
export type Configuration = typeof Configuration.Type;
export const empty: Configuration = { zones: [], folders: [] };
const Position = Schema.Struct({
  folder: Schema.NullOr(Schema.String),
  page: Schema.Int,
  offset: Schema.Int,
});
export const Navigation = Schema.Record(
  Schema.String,
  Schema.Struct({
    ...Position.fields,
    history: Schema.Array(Position).check(Schema.isMaxLength(32)),
  }),
);
export type Navigation = typeof Navigation.Type;
export const root = { folder: null, page: 0, offset: 0, history: [] } as const;
export const Command = Schema.Struct({
  zone: Schema.String,
  operation: Schema.Literals(['next', 'previous', 'back', 'root', 'open', 'scroll']),
  folder: Schema.optionalKey(Schema.String),
  delta: Schema.optionalKey(Schema.Int),
});
export type Command = typeof Command.Type;
export const Input = Schema.Struct({
  lcd: Schema.Int,
  revision: Schema.Int,
  sessionId: Schema.String,
  x: Schema.Number.check(Schema.isFinite()),
  y: Schema.Number.check(Schema.isFinite()),
  toX: Schema.optionalKey(Schema.Number.check(Schema.isFinite())),
  kind: Schema.Literals(['tap', 'hold', 'swipe']),
});
export const View = Schema.Struct({
  revision: Schema.Int,
  focus: Schema.NullOr(Schema.String),
  navigation: Navigation,
});
export type View = typeof View.Type;
export const container = (
  config: Configuration,
  zone: Configuration['zones'][number],
  folder: string | null,
) => {
  if (!folder) return zone;
  const result = config.folders.find((entry) => entry.id === folder);
  if (!result) throw new Error('Dossier LCD introuvable.');
  return result;
};
export const matches = (application: string, focus: string | null) =>
  !application || application.toLowerCase() === focus?.toLowerCase();
export const project = (
  config: Configuration,
  navigation: Navigation,
  lcd: number,
  focus: string | null,
) =>
  config.zones
    .filter((zone) => zone.lcd === lcd && matches(zone.application, focus))
    .map((zone) => {
      const position = navigation[zone.id] ?? root;
      const content = container(config, zone, position.folder);
      const page = Math.max(0, Math.min(position.page, content.pages.length - 1));
      const items = (content.pages[page] ?? []).filter((tile) => matches(tile.application, focus));
      const back: Tile[] = position.folder
        ? [
            {
              id: `back/${zone.id}`,
              plugin: 'system',
              action: 'lcd-back',
              input: { zone: zone.id },
              label: 'Retour',
              width: 100,
              application: '',
            },
          ]
        : [];
      const all = [...back, ...items];
      const contentWidth = all.reduce((sum, tile) => sum + tile.width, 0);
      const offset = Math.max(0, Math.min(position.offset, Math.max(0, contentWidth - zone.width)));
      let cursor = 0 - offset;
      return {
        zone,
        page,
        pages: content.pages.length,
        folder: position.folder,
        offset,
        contentWidth,
        tiles: all.map((tile) => {
          const x = cursor;
          cursor += tile.width;
          return {
            tile,
            x,
            left: Math.max(0, -x),
            width: Math.max(0, Math.min(zone.width, x + tile.width) - Math.max(0, x)),
          };
        }),
      };
    });
export const navigate = (
  config: Configuration,
  before: Navigation,
  command: Command,
  focus: string | null = null,
): Navigation => {
  const zone =
    config.zones.find((entry) => entry.id === command.zone) ??
    (!command.zone || command.zone === 'current' ? config.zones[0] : undefined);
  if (!zone) throw new Error('Zone LCD introuvable.');
  const current = before[zone.id] ?? root;
  const pages = container(config, zone, current.folder).pages.length;
  let next: Navigation[string] = current;
  switch (command.operation) {
    case 'root':
      next = root;
      break;
    case 'back':
      next = { ...(current.history.at(-1) ?? root), history: current.history.slice(0, -1) };
      break;
    case 'open': {
      const folder = config.folders.find(
        (entry) => entry.id === command.folder || entry.name === command.folder,
      );
      if (!folder) throw new Error('Choisis un dossier LCD existant.');
      if (current.history.length >= 32)
        throw new Error('Profondeur maximale des dossiers LCD atteinte.');
      next = {
        folder: folder.id,
        page: 0,
        offset: 0,
        history: [
          ...current.history,
          { folder: current.folder, page: current.page, offset: current.offset },
        ],
      };
      break;
    }
    case 'next':
    case 'previous':
      next = {
        ...current,
        page: (current.page + (command.operation === 'next' ? 1 : -1) + pages) % pages,
        offset: 0,
      };
      break;
    case 'scroll':
      const view = project(config, before, zone.lcd, focus).find(
        (entry) => entry.zone.id === zone.id,
      );
      next = {
        ...current,
        offset: Math.max(
          0,
          Math.min(
            Math.max(0, (view?.contentWidth ?? zone.width) - zone.width),
            (view?.offset ?? 0) + (command.delta ?? 0),
          ),
        ),
      };
      break;
  }
  return { ...before, [zone.id]: next };
};
/** Geometry is checked against the real device at save time, before any persistence write. */
export const validate = (
  config: Configuration,
  lcds?: ReadonlyArray<{ index: number; width: number }>,
) => {
  const ids = new Set<string>();
  for (const entry of [...config.zones, ...config.folders]) {
    if (ids.has(entry.id))
      throw new Error('Les identifiants des zones et dossiers LCD doivent être uniques.');
    ids.add(entry.id);
  }
  const tiles = new Set<string>();
  for (const owner of [...config.zones, ...config.folders])
    for (const page of owner.pages)
      for (const tile of page) {
        if (tiles.has(tile.id)) throw new Error('Identifiant de tile LCD dupliqué.');
        tiles.add(tile.id);
      }
  for (const zone of config.zones) {
    if (lcds && !lcds.some((lcd) => lcd.index === zone.lcd && zone.x + zone.width <= lcd.width))
      throw new Error('La zone doit tenir dans l’écran LCD.');
    if (
      config.zones.some(
        (other) =>
          other !== zone &&
          other.lcd === zone.lcd &&
          other.x < zone.x + zone.width &&
          zone.x < other.x + other.width,
      )
    )
      throw new Error('Les zones LCD ne peuvent pas se chevaucher.');
  }
};
