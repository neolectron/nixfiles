import { invariant } from './errors.ts';
import * as LcdLayout from './lcd-layout.ts';
import type { Entry, LayoutView, Navigate, Organize, Profile } from './studio-contract.ts';
const free = (list: ReadonlyArray<number>, pinned: Readonly<Record<string, Entry>>) =>
  list.filter((key) => !pinned[String(key)]);
type Position = {
  readonly folder: string | null;
  readonly page: number;
};
export type Navigation = Readonly<
  Record<
    string,
    Position & {
      readonly history: ReadonlyArray<Position>;
    }
  >
>;
const root = { folder: null, page: 0, history: [] };
export const position = (navigation: Navigation, zone: string) => navigation[zone] ?? root;
export type MutableProfile = {
  version: 2;
  lcd?: import('./lcd-layout.ts').Configuration;
  zones: Array<{
    id: string;
    name: string;
    keys: number[];
    items: Array<Entry | null>;
    minimumPages?: number;
    pinned: Record<string, Entry>;
  }>;
  folders: Array<{
    id: string;
    name: string;
    items: Array<Entry | null>;
    minimumPages?: number;
  }>;
};
export const copy = (profile: Profile) => structuredClone(profile) as MutableProfile;
export const entries = (profile: Profile) =>
  [
    ...profile.zones.flatMap((zone) => [...zone.items, ...Object.values(zone.pinned)]),
    ...profile.folders.flatMap((folder) => folder.items),
  ].filter((entry): entry is Entry => entry !== null);
export const container = (profile: Profile, zoneId: string, folder: string | null) => {
  const result =
    folder === null
      ? profile.zones.find((zone) => zone.id === zoneId)
      : profile.folders.find((item) => item.id === folder);
  if (!result) throw new Error('Cette zone ou ce dossier n’existe plus.');
  return result;
};
export const capacity = (zone: Profile['zones'][number], folder: string | null) =>
  zone.keys.length - Object.keys(zone.pinned).length - (folder === null ? 0 : 1);
export const pageCount = (
  profile: Profile,
  zone: Profile['zones'][number],
  folder: string | null,
) => {
  const owner = container(profile, zone.id, folder);
  const length = owner.items.findLastIndex((entry) => entry !== null) + 1;
  return Math.max(owner.minimumPages ?? 1, Math.ceil(length / Math.max(1, capacity(zone, folder))));
};
/** Pure layout projection. Stable entry IDs keep execution independent of physical slots. */
export const project = (profile: Profile, navigation: Navigation, revision: number) => {
  const keys = new Map<
    number,
    {
      entry: Entry | null;
      address: string;
      zone: string;
      pinned: boolean;
      virtual: boolean;
      slot: number | null;
    }
  >();
  const zones: LayoutView['zones'][number][] = [];
  for (const zone of profile.zones) {
    const current = position(navigation, zone.id);
    const pages = pageCount(profile, zone, current.folder);
    const page = Math.min(current.page, pages - 1);
    const content = container(profile, zone.id, current.folder).items;
    const size = Math.max(1, capacity(zone, current.folder));
    for (const key of zone.keys) {
      const pinned = zone.pinned[String(key)];
      const index = free(zone.keys, zone.pinned).indexOf(key);
      const virtual = !pinned && current.folder !== null && index === 0;
      const slot =
        pinned || virtual ? null : page * size + index - (current.folder === null ? 0 : 1);
      const entry =
        pinned ??
        (virtual
          ? {
              id: `navigation/${zone.id}`,
              binding: { label: 'Retour', action: 'go-back' as const, parameters: {} },
            }
          : (content[invariant(slot, 'studio-layout')] ?? null));
      keys.set(key, {
        entry,
        zone: zone.id,
        pinned: !!pinned,
        virtual,
        slot,
        address: JSON.stringify([
          zone.id,
          pinned ? 'pinned' : current.folder,
          pinned ? 0 : page,
          key,
          pinned ? 'pinned' : slot,
          entry?.id ?? null,
        ]),
      });
    }
    zones.push({
      id: zone.id,
      name: zone.name,
      keys: zone.keys,
      folder: current.folder,
      page,
      pages,
      breadcrumbs: [...current.history.map(({ folder }) => folder), current.folder]
        .filter((id): id is string => id !== null)
        .map((id) => ({
          id,
          name: invariant(
            profile.folders.find((folder) => folder.id === id),
            'studio-layout',
          ).name,
        })),
    });
  }
  return {
    keys,
    layout: {
      revision,
      zones,
      folders: profile.folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        count: folder.items.filter(Boolean).length,
      })),
    } satisfies LayoutView,
  };
};
export const navigate = (profile: Profile, before: Navigation, command: Navigate): Navigation => {
  const zone = profile.zones.find((candidateZone) => candidateZone.id === command.zone);
  if (!zone) throw new Error('Zone introuvable.');
  const current = position(before, zone.id);
  if (command.operation === 'root') return { ...before, [zone.id]: root };
  if (command.operation === 'back') {
    const previous = current.history.at(-1);
    return {
      ...before,
      [zone.id]: previous ? { ...previous, history: current.history.slice(0, -1) } : root,
    };
  }
  if (command.operation === 'open') {
    if (!profile.folders.some((folder) => folder.id === command.folder))
      throw new Error('Dossier introuvable.');
    if (current.folder === command.folder) return before;
    if (capacity(zone, invariant(command.folder, 'studio-layout')) < 1)
      throw new Error(
        'Il faut au moins deux touches non fixées dans cette zone pour ouvrir un dossier.',
      );
    if (current.history.length >= 32)
      throw new Error('Reviens au début de la zone avant d’ouvrir ce dossier.');
    return {
      ...before,
      [zone.id]: {
        folder: invariant(command.folder, 'studio-layout'),
        page: 0,
        history: [...current.history, { folder: current.folder, page: current.page }],
      },
    };
  }
  const pages = pageCount(profile, zone, current.folder);
  return {
    ...before,
    [zone.id]: {
      ...current,
      page:
        (Math.min(current.page, pages - 1) + (command.operation === 'next' ? 1 : -1) + pages) %
        pages,
    },
  };
};
export const validate = (profile: Profile, deviceKeys: ReadonlyArray<number>) => {
  LcdLayout.validate(profile.lcd ?? LcdLayout.empty);
  const assigned = new Set<number>();
  const ids = new Set<string>();
  if (!profile.zones.some((zone) => zone.id === 'deck'))
    throw new Error('La zone principale est manquante.');
  for (const zone of profile.zones) {
    if (ids.has(zone.id) || !zone.name.trim() || !zone.keys.length)
      throw new Error('Chaque zone doit avoir un nom, un identifiant unique et des touches.');
    ids.add(zone.id);
    for (const key of zone.keys) {
      if (!deviceKeys.includes(key) || assigned.has(key))
        throw new Error('Les zones doivent utiliser des touches distinctes du deck.');
      assigned.add(key);
    }
    for (const key of Object.keys(zone.pinned))
      if (String(Number(key)) !== key || !zone.keys.includes(Number(key)))
        throw new Error('Une touche fixée doit appartenir à sa zone.');
    if (capacity(zone, null) < 1) throw new Error('Garde au moins une touche non fixée par zone.');
    if (
      capacity(zone, null) < 2 &&
      [...zone.items, ...Object.values(zone.pinned)].some(
        (entry) =>
          entry?.binding.action === 'open-folder' &&
          (!entry.binding.parameters.target ||
            entry.binding.parameters.target === 'current' ||
            entry.binding.parameters.target === zone.id),
      )
    )
      throw new Error(
        'Une zone ouvrant un dossier sur place doit garder deux touches non fixées : Retour et contenu.',
      );
  }
  if (assigned.size !== deviceKeys.length)
    throw new Error('Chaque touche doit appartenir à une zone.');
  const folderIds = new Set<string>();
  for (const folder of profile.folders) {
    if (folderIds.has(folder.id) || !folder.name.trim())
      throw new Error('Chaque dossier doit avoir un nom et un identifiant unique.');
    folderIds.add(folder.id);
  }
  const itemIds = new Set<string>();
  for (const entry of entries(profile)) {
    if (itemIds.has(entry.id) || entry.id.startsWith('navigation/'))
      throw new Error('Un raccourci ne peut être présent qu’à un seul emplacement.');
    itemIds.add(entry.id);
    if (entry.binding.action === 'open-folder' && !folderIds.has(entry.binding.parameters.folder))
      throw new Error('Le dossier ciblé n’existe pas.');
    if (
      entry.binding.action === 'open-folder' &&
      entry.binding.parameters.target &&
      entry.binding.parameters.target !== 'current'
    ) {
      const targetId = entry.binding.parameters.target;
      const target = profile.zones.find((zone) => zone.id === targetId);
      if (!target) throw new Error('La zone du dossier n’existe pas.');
      if (capacity(target, null) < 2)
        throw new Error(
          'La zone du dossier doit garder deux touches non fixées : Retour et contenu.',
        );
    }
    if (
      (entry.binding.action === 'page-next' || entry.binding.action === 'page-previous') &&
      !['current', 'audio', ...ids].includes(entry.binding.parameters.target)
    )
      throw new Error('La zone de pagination ciblée n’existe pas.');
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (id: string) => {
    if (active.has(id))
      throw new Error(
        'Un dossier ne peut pas contenir un lien vers lui-même ou un de ses parents.',
      );
    if (visited.has(id)) return;
    active.add(id);
    for (const entry of invariant(
      profile.folders.find((folder) => folder.id === id),
      'studio-layout',
    ).items)
      if (entry?.binding.action === 'open-folder') visit(entry.binding.parameters.folder);
    active.delete(id);
    visited.add(id);
  };
  for (const folder of profile.folders) visit(folder.id);
};
export const replace = (
  profile: MutableProfile,
  navigation: Navigation,
  key: number,
  entry: Entry | null,
) => {
  const view = project(profile, navigation, 0).keys.get(key);
  if (!view || view.virtual)
    throw new Error('Cette touche sert au retour du dossier et ne peut pas être modifiée.');
  const zone = invariant(
    profile.zones.find((candidateZone) => candidateZone.id === view.zone),
    'studio-layout',
  );
  if (view.pinned) {
    if (entry) zone.pinned[String(key)] = invariant(entry, 'studio-layout');
    else delete zone.pinned[String(key)];
  } else {
    const items = container(profile, zone.id, position(navigation, zone.id).folder)
      .items as Array<Entry | null>;
    while (items.length <= invariant(view.slot, 'studio-layout')) items.push(null);
    items[invariant(view.slot, 'studio-layout')] = entry;
  }
};
export const move = (profile: MutableProfile, id: string, destination: string) => {
  const entry = entries(profile).find((candidateEntry) => candidateEntry.id === id);
  if (!entry) throw new Error('Ce raccourci n’existe plus.');
  const target = destination.startsWith('zone:')
    ? profile.zones.find((zone) => zone.id === destination.slice(5))
    : destination.startsWith('folder:')
      ? profile.folders.find((folder) => folder.id === destination.slice(7))
      : undefined;
  if (!target) throw new Error('Choisis une zone ou un dossier de destination.');
  for (const source of [...profile.zones, ...profile.folders]) {
    for (const [index, item] of source.items.entries())
      if (item?.id === id) source.items[index] = null;
  }
  for (const zone of profile.zones)
    for (const [key, item] of Object.entries(zone.pinned))
      if (item.id === id) delete zone.pinned[key];
  const hole = target.items.indexOf(null);
  if (hole < 0) target.items.push(entry);
  else target.items[hole] = entry;
};
/** Exchange captured storage locations atomically; fixed status belongs to the physical slot. */
export const exchange = (
  profile: MutableProfile,
  navigation: Navigation,
  source: number,
  target: number,
) => {
  const view = project(profile, navigation, 0);
  const from = view.keys.get(source);
  const to = view.keys.get(target);
  if (!from || !to || from.virtual || to.virtual)
    throw new Error('La touche Retour automatique ne peut pas être déplacée ou remplacée.');
  if (!from.entry) throw new Error('Choisis une touche avec un raccourci à déplacer.');
  if (source === target || from.entry.id === to.entry?.id) return;
  if (from.pinned && !to.entry) {
    if (from.zone !== to.zone)
      throw new Error(
        'Décoche « Fixer sur toutes les pages » avant de déplacer cette touche vers une case libre d’une autre zone.',
      );
    const zone = invariant(
      profile.zones.find((candidateZone) => candidateZone.id === from.zone),
      'studio-layout',
    );
    // Relocate the fixed slot on every page. Its former position inherits the free slot's contents.
    delete zone.pinned[String(source)];
    zone.pinned[String(target)] = from.entry;
    zone.keys = zone.keys.map((key) => (key === source ? target : key === target ? source : key));
    return;
  }
  // Both addresses are resolved before writing: replacing a pin must not shift a page mid-exchange.
  const write = (key: number, currentSlot: typeof from, entry: Entry | null) => {
    const zone = invariant(
      profile.zones.find((candidateZone) => candidateZone.id === currentSlot.zone),
      'studio-layout',
    );
    if (currentSlot.pinned) zone.pinned[String(key)] = invariant(entry, 'studio-layout');
    else {
      const items = container(profile, zone.id, position(navigation, zone.id).folder)
        .items as Array<Entry | null>;
      while (items.length <= invariant(currentSlot.slot, 'studio-layout')) items.push(null);
      items[invariant(currentSlot.slot, 'studio-layout')] = entry;
    }
  };
  write(source, from, to.entry);
  write(target, to, from.entry);
};
/** Splitting the main zone preserves every root page and each shortcut's identity. */
export const createZone = (
  profile: MutableProfile,
  id: string,
  name: string,
  selection: ReadonlyArray<number>,
) => {
  const source = invariant(
    profile.zones.find((zone) => zone.id === 'deck'),
    'studio-layout',
  );
  const keys = [...new Set(selection)].toSorted((a, b) => a - b);
  if (!keys.length || keys.some((key) => !source.keys.includes(key) || source.pinned[String(key)]))
    throw new Error('Choisis des touches non fixées de la zone principale.');
  const old = source.keys.filter((key) => !source.pinned[String(key)]);
  const remaining = old.filter((key) => !keys.includes(key));
  if (!remaining.length)
    throw new Error('Garde au moins une touche non fixée dans la zone principale.');
  const target = {
    id,
    name,
    keys,
    minimumPages: source.minimumPages ?? 1,
    items: [] as Array<Entry | null>,
    pinned: {},
  };
  const original = source.items;
  source.items = [];
  for (const [index, entry] of original.entries()) {
    const key = invariant(old[index % old.length], 'studio-layout');
    const page = Math.floor(index / old.length);
    const list = keys.includes(key) ? target.items : source.items;
    const positions = keys.includes(key) ? keys : remaining;
    const slot = page * positions.length + positions.indexOf(key);
    while (list.length <= slot) list.push(null);
    list[slot] = entry;
  }
  const pages = Math.max(
    source.minimumPages ?? 1,
    Math.ceil((original.findLastIndex((entry) => entry !== null) + 1) / old.length),
  );
  source.minimumPages = pages;
  target.minimumPages = pages;
  source.keys = source.keys.filter((key) => !keys.includes(key));
  profile.zones.push(target);
};
/** Exchange physical slots with the main zone, preserving every root page and fixed key. */
export const resizeZone = (
  profile: MutableProfile,
  id: string,
  selection: ReadonlyArray<number>,
) => {
  const main = invariant(
    profile.zones.find((zone) => zone.id === 'deck'),
    'studio-layout',
  );
  const target = profile.zones.find((zone) => zone.id === id);
  if (!target || target === main)
    throw new Error(
      'Redimensionne une zone dédiée ; la zone principale reçoit les touches restantes.',
    );
  const keys = [...new Set(selection)].toSorted((a, b) => a - b);
  if (
    !keys.length ||
    keys.some(
      (key) => !target.keys.includes(key) && (!main.keys.includes(key) || main.pinned[String(key)]),
    )
  )
    throw new Error(
      'Choisis des touches de cette zone ou des touches non fixées de la zone principale.',
    );
  if (Object.keys(target.pinned).some((key) => !keys.includes(Number(key))))
    throw new Error('Les touches fixées doivent rester dans leur zone.');
  const mainKeys = [...new Set([...main.keys, ...target.keys])]
    .filter((key) => !keys.includes(key))
    .toSorted((a, b) => a - b);
  const nextMain = free(mainKeys, main.pinned);
  const nextTarget = free(keys, target.pinned);
  if (!nextMain.length || !nextTarget.length)
    throw new Error('Garde au moins une touche non fixée dans chaque zone.');
  const sources = [main, target].map((zone) => ({
    keys: free(zone.keys, zone.pinned),
    items: zone.items,
    pages: pageCount(profile, zone, null),
  }));
  main.items = [];
  target.items = [];
  for (const source of sources)
    for (const [index, entry] of source.items.entries()) {
      const key = invariant(source.keys[index % source.keys.length], 'studio-layout');
      const page = Math.floor(index / source.keys.length);
      const destination = keys.includes(key) ? target : main;
      const positions = destination === target ? nextTarget : nextMain;
      const slot = page * positions.length + positions.indexOf(key);
      while (destination.items.length <= slot) destination.items.push(null);
      destination.items[slot] = entry;
    }
  main.keys = mainKeys;
  target.keys = keys;
  // Empty pages explicitly created by the user remain navigable after a resize.
  main.minimumPages = target.minimumPages = Math.max(...sources.map((source) => source.pages));
};

export const validateNavigation = (profile: Profile, navigation: Navigation) => {
  for (const [id, current] of Object.entries(navigation)) {
    if (!profile.zones.some((zone) => zone.id === id))
      throw new Error('Zone de navigation introuvable.');
    for (const cursor of [current, ...current.history])
      if (cursor.folder !== null && !profile.folders.some((folder) => folder.id === cursor.folder))
        throw new Error('Dossier de navigation introuvable.');
  }
};

/** The same pure layout operation powers browser drafts and the persisted controller. */
export const organize = (
  profile: MutableProfile,
  before: Navigation,
  command: Organize,
  ids: { entry: string; folder: string; zone: string },
): Navigation => {
  let navigation = before;
  const key = (index: number, address: string) => {
    const slot = project(profile, navigation, 0).keys.get(index);
    if (!slot || slot.address !== address) throw new Error('La page ou la touche a changé.');
    return slot;
  };
  if (command.operation === 'exchange') {
    key(command.source, command.sourceAddress);
    key(command.target, command.targetAddress);
    exchange(profile, navigation, command.source, command.target);
  } else if (command.operation === 'create-folder') {
    const slot = key(command.key, command.address);
    if (slot.entry || slot.virtual)
      throw new Error('Sélectionne une touche libre pour créer un dossier.');
    profile.folders.push({ id: ids.folder, name: command.name, items: [] });
    replace(profile, navigation, command.key, {
      id: ids.entry,
      binding: {
        label: command.name,
        action: 'open-folder',
        parameters: { folder: ids.folder, target: command.target ?? 'current' },
      },
    });
  } else if (command.operation === 'move') move(profile, command.id, command.destination);
  else if (command.operation === 'create-zone')
    createZone(profile, ids.zone, command.name, command.keys);
  else if (command.operation === 'resize-zone') {
    resizeZone(profile, command.zone, command.keys);
    navigation = navigate(profile, navigation, { zone: 'deck', operation: 'root' });
    navigation = navigate(profile, navigation, { zone: command.zone, operation: 'root' });
  } else if (command.operation === 'rename-folder') {
    const folder = profile.folders.find((candidateFolder) => candidateFolder.id === command.id);
    if (!folder) throw new Error('Dossier introuvable.');
    folder.name = command.name;
    const renamed = (entry: Entry | null) =>
      entry?.binding.action === 'open-folder' && entry.binding.parameters.folder === folder.id
        ? { ...entry, binding: { ...entry.binding, label: command.name } }
        : entry;
    for (const owner of [...profile.zones, ...profile.folders])
      owner.items = owner.items.map(renamed);
    for (const zone of profile.zones)
      for (const [index, entry] of Object.entries(zone.pinned))
        zone.pinned[index] = invariant(renamed(entry), 'studio-layout');
  } else if (command.operation === 'pin') {
    const slot = key(command.key, command.address);
    if (!slot.entry || slot.virtual) throw new Error('Choisis un raccourci pour le fixer.');
    const zone = invariant(
      profile.zones.find((candidateZone) => candidateZone.id === slot.zone),
      'studio-layout',
    );
    if (command.value && !slot.pinned) {
      replace(profile, navigation, command.key, null);
      zone.pinned[String(command.key)] = slot.entry;
    } else if (!command.value && slot.pinned) {
      delete zone.pinned[String(command.key)];
      const items = container(profile, zone.id, position(navigation, zone.id).folder)
        .items as Array<Entry | null>;
      const hole = items.indexOf(null);
      if (hole < 0) items.push(slot.entry);
      else items[hole] = slot.entry;
    }
  } else {
    const zone = profile.zones.find((candidateZone) => candidateZone.id === command.zone);
    if (!zone) throw new Error('Zone introuvable.');
    const current = position(navigation, zone.id);
    if (capacity(zone, current.folder) < 1)
      throw new Error('Cette zone n’a pas de place disponible.');
    const owner = container(profile, zone.id, current.folder) as MutableProfile['folders'][number];
    const page = pageCount(profile, zone, current.folder);
    owner.minimumPages = page + 1;
    navigation = { ...navigation, [zone.id]: { ...current, page } };
  }
  return navigation;
};
