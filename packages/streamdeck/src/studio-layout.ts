import type { Entry, LayoutView, Navigate, Profile } from './studio-contract.ts';

type Position = { readonly folder: string | null; readonly page: number };
export type Navigation = Readonly<Record<string, Position & { readonly history: ReadonlyArray<Position> }>>;
const root = { folder: null, page: 0, history: [] };
export const position = (navigation: Navigation, zone: string) => navigation[zone] ?? root;
export type MutableProfile = { version: 2; zones: Array<{ id: string; name: string; keys: number[]; items: Array<Entry | null>; minimumPages?: number; pinned: Record<string, Entry> }>; folders: Array<{ id: string; name: string; items: Array<Entry | null>; minimumPages?: number }> };
export const copy = (profile: Profile) => structuredClone(profile) as MutableProfile;
export const entries = (profile: Profile) => [
  ...profile.zones.flatMap((zone) => [...zone.items, ...Object.values(zone.pinned)]), ...profile.folders.flatMap((folder) => folder.items),
].filter((entry): entry is Entry => entry !== null);
export const container = (profile: Profile, zoneId: string, folder: string | null) => {
  const result = folder === null ? profile.zones.find((zone) => zone.id === zoneId) : profile.folders.find((item) => item.id === folder);
  if (!result) throw new Error('Cette zone ou ce dossier n’existe plus.');
  return result;
};
export const capacity = (zone: Profile['zones'][number], folder: string | null) => zone.keys.length - Object.keys(zone.pinned).length - (folder === null ? 0 : 1);
export const pageCount = (profile: Profile, zone: Profile['zones'][number], folder: string | null) => {
  const owner = container(profile, zone.id, folder);
  const length = owner.items.findLastIndex((entry) => entry !== null) + 1;
  return Math.max(owner.minimumPages ?? 1, Math.ceil(length / Math.max(1, capacity(zone, folder))));
};

/** Pure layout projection. Stable entry IDs keep execution independent of physical slots. */
export const project = (profile: Profile, navigation: Navigation, revision: number) => {
  const keys = new Map<number, { entry: Entry | null; address: string; zone: string; pinned: boolean; virtual: boolean; slot: number | null }>();
  const zones: LayoutView['zones'][number][] = [];
  for (const zone of profile.zones) {
    const current = position(navigation, zone.id);
    const pages = pageCount(profile, zone, current.folder); const page = Math.min(current.page, pages - 1);
    const free = zone.keys.filter((key) => !zone.pinned[String(key)]);
    const content = container(profile, zone.id, current.folder).items;
    const size = Math.max(1, capacity(zone, current.folder));
    for (const key of zone.keys) {
      const pinned = zone.pinned[String(key)]; const index = free.indexOf(key);
      const virtual = !pinned && current.folder !== null && index === 0;
      const slot = pinned || virtual ? null : page * size + index - (current.folder === null ? 0 : 1);
      const entry = pinned ?? (virtual ? { id: `navigation/${zone.id}`, binding: { label: 'Retour', action: 'go-back' as const, parameters: {} } } : content[slot!] ?? null);
      keys.set(key, { entry, zone: zone.id, pinned: !!pinned, virtual, slot,
        address: JSON.stringify([zone.id, pinned ? 'pinned' : current.folder, pinned ? 0 : page, key, pinned ? 'pinned' : slot, entry?.id ?? null]),
      });
    }
    zones.push({ id: zone.id, name: zone.name, keys: zone.keys, folder: current.folder, page, pages,
      breadcrumbs: [...current.history.map(({ folder }) => folder), current.folder].filter((id): id is string => id !== null)
        .map((id) => ({ id, name: profile.folders.find((folder) => folder.id === id)!.name })),
    });
  }
  return { keys, layout: { revision, zones, folders: profile.folders.map((folder) => ({ id: folder.id, name: folder.name, count: folder.items.filter(Boolean).length })) } satisfies LayoutView };
};

export const navigate = (profile: Profile, before: Navigation, command: Navigate): Navigation => {
  const zone = profile.zones.find((zone) => zone.id === command.zone);
  if (!zone) throw new Error('Zone introuvable.');
  const current = position(before, zone.id);
  if (command.operation === 'root') return { ...before, [zone.id]: root };
  if (command.operation === 'back') {
    const previous = current.history.at(-1);
    return { ...before, [zone.id]: previous ? { ...previous, history: current.history.slice(0, -1) } : root };
  }
  if (command.operation === 'open') {
    if (!profile.folders.some((folder) => folder.id === command.folder)) throw new Error('Dossier introuvable.');
    if (current.folder === command.folder) return before;
    if (capacity(zone, command.folder!) < 1) throw new Error('Il faut au moins deux touches non fixées dans cette zone pour ouvrir un dossier.');
    if (current.history.length >= 32) throw new Error('Reviens au début de la zone avant d’ouvrir ce dossier.');
    return { ...before, [zone.id]: { folder: command.folder!, page: 0, history: [...current.history, { folder: current.folder, page: current.page }] } };
  }
  const pages = pageCount(profile, zone, current.folder);
  return { ...before, [zone.id]: { ...current, page: (Math.min(current.page, pages - 1) + (command.operation === 'next' ? 1 : -1) + pages) % pages } };
};

export const validate = (profile: Profile, deviceKeys: ReadonlyArray<number>) => {
  const assigned = new Set<number>(); const ids = new Set<string>();
  if (!profile.zones.some((zone) => zone.id === 'deck')) throw new Error('La zone principale est manquante.');
  for (const zone of profile.zones) {
    if (ids.has(zone.id) || !zone.name.trim() || !zone.keys.length) throw new Error('Chaque zone doit avoir un nom, un identifiant unique et des touches.');
    ids.add(zone.id);
    for (const key of zone.keys) {
      if (!deviceKeys.includes(key) || assigned.has(key)) throw new Error('Les zones doivent utiliser des touches distinctes du deck.');
      assigned.add(key);
    }
    for (const key of Object.keys(zone.pinned)) if (String(Number(key)) !== key || !zone.keys.includes(Number(key))) throw new Error('Une touche fixée doit appartenir à sa zone.');
    if (capacity(zone, null) < 1) throw new Error('Garde au moins une touche non fixée par zone.');
    if (capacity(zone, null) < 2 && [...zone.items, ...Object.values(zone.pinned)].some((entry) => entry?.binding.action === 'open-folder' && (!entry.binding.parameters.target || entry.binding.parameters.target === 'current' || entry.binding.parameters.target === zone.id))) throw new Error('Une zone ouvrant un dossier sur place doit garder deux touches non fixées : Retour et contenu.');
  }
  if (assigned.size !== deviceKeys.length) throw new Error('Chaque touche doit appartenir à une zone.');
  const folderIds = new Set<string>();
  for (const folder of profile.folders) {
    if (folderIds.has(folder.id) || !folder.name.trim()) throw new Error('Chaque dossier doit avoir un nom et un identifiant unique.');
    folderIds.add(folder.id);
  }
  const itemIds = new Set<string>();
  for (const entry of entries(profile)) {
    if (itemIds.has(entry.id) || entry.id.startsWith('navigation/')) throw new Error('Un raccourci ne peut être présent qu’à un seul emplacement.');
    itemIds.add(entry.id);
    if (entry.binding.action === 'open-folder' && !folderIds.has(entry.binding.parameters.folder)) throw new Error('Le dossier ciblé n’existe pas.');
    if (entry.binding.action === 'open-folder' && entry.binding.parameters.target && entry.binding.parameters.target !== 'current') {
      const targetId = entry.binding.parameters.target;
      const target = profile.zones.find((zone) => zone.id === targetId);
      if (!target) throw new Error('La zone du dossier n’existe pas.');
      if (capacity(target, null) < 2) throw new Error('La zone du dossier doit garder deux touches non fixées : Retour et contenu.');
    }
    if ((entry.binding.action === 'page-next' || entry.binding.action === 'page-previous') && !['current', 'audio', ...ids].includes(entry.binding.parameters.target)) throw new Error('La zone de pagination ciblée n’existe pas.');
  }
  const visited = new Set<string>(); const active = new Set<string>();
  const visit = (id: string) => {
    if (active.has(id)) throw new Error('Un dossier ne peut pas contenir un lien vers lui-même ou un de ses parents.');
    if (visited.has(id)) return;
    active.add(id);
    for (const entry of profile.folders.find((folder) => folder.id === id)!.items) if (entry?.binding.action === 'open-folder') visit(entry.binding.parameters.folder);
    active.delete(id); visited.add(id);
  };
  for (const folder of profile.folders) visit(folder.id);
};

export const replace = (profile: MutableProfile, navigation: Navigation, key: number, entry: Entry | null) => {
  const view = project(profile, navigation, 0).keys.get(key);
  if (!view || view.virtual) throw new Error('Cette touche sert au retour du dossier et ne peut pas être modifiée.');
  const zone = profile.zones.find((zone) => zone.id === view.zone)!;
  if (view.pinned) { if (entry) zone.pinned[String(key)] = entry; else delete zone.pinned[String(key)]; }
  else {
    const items = container(profile, zone.id, position(navigation, zone.id).folder).items as Array<Entry | null>;
    while (items.length <= view.slot!) items.push(null);
    items[view.slot!] = entry;
  }
};

export const move = (profile: MutableProfile, id: string, destination: string) => {
  const entry = entries(profile).find((entry) => entry.id === id);
  if (!entry) throw new Error('Ce raccourci n’existe plus.');
  const target = destination.startsWith('zone:') ? profile.zones.find((zone) => zone.id === destination.slice(5)) : destination.startsWith('folder:') ? profile.folders.find((folder) => folder.id === destination.slice(7)) : undefined;
  if (!target) throw new Error('Choisis une zone ou un dossier de destination.');
  for (const source of [...profile.zones, ...profile.folders]) {
    for (const [index, item] of source.items.entries()) if (item?.id === id) source.items[index] = null;
  }
  for (const zone of profile.zones) for (const [key, item] of Object.entries(zone.pinned)) if (item.id === id) delete zone.pinned[key];
  const hole = target.items.indexOf(null); if (hole < 0) target.items.push(entry); else target.items[hole] = entry;
};

/** Splitting the main zone preserves every root page and each shortcut's identity. */
export const createZone = (profile: MutableProfile, id: string, name: string, selection: ReadonlyArray<number>) => {
  const source = profile.zones.find((zone) => zone.id === 'deck')!;
  const keys = [...new Set(selection)].sort((a, b) => a - b);
  if (!keys.length || keys.some((key) => !source.keys.includes(key) || source.pinned[String(key)])) throw new Error('Choisis des touches non fixées de la zone principale.');
  const old = source.keys.filter((key) => !source.pinned[String(key)]);
  const remaining = old.filter((key) => !keys.includes(key));
  if (!remaining.length) throw new Error('Garde au moins une touche non fixée dans la zone principale.');
  const target = { id, name, keys, minimumPages: source.minimumPages ?? 1, items: [] as Array<Entry | null>, pinned: {} };
  const original = source.items; source.items = [];
  for (const [index, entry] of original.entries()) {
    const key = old[index % old.length]!; const page = Math.floor(index / old.length);
    const list = keys.includes(key) ? target.items : source.items;
    const positions = keys.includes(key) ? keys : remaining;
    const slot = page * positions.length + positions.indexOf(key);
    while (list.length <= slot) list.push(null); list[slot] = entry;
  }
  const pages = Math.max(source.minimumPages ?? 1, Math.ceil((original.findLastIndex((entry) => entry !== null) + 1) / old.length));
  source.minimumPages = pages; target.minimumPages = pages;
  source.keys = source.keys.filter((key) => !keys.includes(key));
  profile.zones.push(target);
};

/** Exchange physical slots with the main zone, preserving every root page and fixed key. */
export const resizeZone = (profile: MutableProfile, id: string, selection: ReadonlyArray<number>) => {
  const main = profile.zones.find((zone) => zone.id === 'deck')!;
  const target = profile.zones.find((zone) => zone.id === id);
  if (!target || target === main) throw new Error('Redimensionne une zone dédiée ; la zone principale reçoit les touches restantes.');
  const keys = [...new Set(selection)].sort((a, b) => a - b);
  if (!keys.length || keys.some((key) => !target.keys.includes(key) && (!main.keys.includes(key) || main.pinned[String(key)]))) throw new Error('Choisis des touches de cette zone ou des touches non fixées de la zone principale.');
  if (Object.keys(target.pinned).some((key) => !keys.includes(Number(key)))) throw new Error('Les touches fixées doivent rester dans leur zone.');
  const mainKeys = [...new Set([...main.keys, ...target.keys])].filter((key) => !keys.includes(key)).sort((a, b) => a - b);
  const free = (list: number[], pinned: Record<string, Entry>) => list.filter((key) => !pinned[String(key)]);
  const nextMain = free(mainKeys, main.pinned); const nextTarget = free(keys, target.pinned);
  if (!nextMain.length || !nextTarget.length) throw new Error('Garde au moins une touche non fixée dans chaque zone.');
  const sources = [main, target].map((zone) => ({ keys: free(zone.keys, zone.pinned), items: zone.items, pages: pageCount(profile, zone, null) }));
  main.items = []; target.items = [];
  for (const source of sources) for (const [index, entry] of source.items.entries()) {
    const key = source.keys[index % source.keys.length]!; const page = Math.floor(index / source.keys.length);
    const destination = keys.includes(key) ? target : main; const positions = destination === target ? nextTarget : nextMain;
    const slot = page * positions.length + positions.indexOf(key);
    while (destination.items.length <= slot) destination.items.push(null);
    destination.items[slot] = entry;
  }
  main.keys = mainKeys; target.keys = keys;
  // Empty pages explicitly created by the user remain navigable after a resize.
  main.minimumPages = target.minimumPages = Math.max(...sources.map((source) => source.pages));
};
