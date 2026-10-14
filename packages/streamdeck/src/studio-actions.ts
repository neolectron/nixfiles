import { createElement } from 'react';
import { Crypto, Effect, Fiber, FileSystem, Path, Ref, Schema, Semaphore } from 'effect';
import * as Commands from './plugins/commands.ts';
import { StudioError } from './studio-errors.ts';
import { ButtonBinding, Profile, StoredProfile, actionParameters, type ActionDefinition, type ApplicationEntry, type BindingStatus, type Entry, type Navigate, type Organize } from './studio-contract.ts';
import * as Layout from './studio-layout.ts';
import type { Device } from './stream-deck.ts';
import * as Takumi from './takumi.ts';
import { KeyCard } from './ui/key-card.ts';

const invalid = (message: string, status = 400) => new StudioError({ message, status });
const checked = <A>(run: () => A) => Effect.try({ try: run, catch: (error) => invalid(error instanceof Error ? error.message : 'Organisation invalide.') });
export const catalogue: ReadonlyArray<ActionDefinition> = [
  { id: 'plugin', name: 'Action d’un plugin', description: 'Exécute une action déclarée par un plugin, avec ses paramètres validés.', defaults: { plugin: '', command: '', input: {} }, schema: Schema.toJsonSchemaDocument(actionParameters.plugin), fields: [] },
  { id: 'launch-app', name: 'Lancer une application', description: 'Ouvre une application installée sur ce bureau.', defaults: { application: '' }, schema: Schema.toJsonSchemaDocument(actionParameters['launch-app']),
    fields: [{ key: 'application', label: 'Application', kind: 'app', hint: '' }] },
  { id: 'run-command', name: 'Exécuter une commande', description: 'Lance un exécutable ou un script avec ses arguments.', defaults: { executable: '', arguments: [], directory: '' }, schema: Schema.toJsonSchemaDocument(actionParameters['run-command']),
    fields: [{ key: 'executable', label: 'Exécutable ou script', kind: 'text', hint: 'Un nom disponible dans PATH ou un chemin absolu.' },
      { key: 'arguments', label: 'Arguments', kind: 'arguments', hint: 'Un argument par ligne, transmis tel quel.' },
      { key: 'directory', label: 'Dossier de travail', kind: 'text', hint: 'Facultatif. Par défaut, le dossier du moteur.' }] },
  { id: 'counter', name: 'Compteur', description: 'Incrémente une valeur sur la touche pour tester un comportement.', defaults: { start: 0 }, schema: Schema.toJsonSchemaDocument(actionParameters.counter), fields: [{ key: 'start', label: 'Valeur de départ', kind: 'number', hint: '' }] },
  { id: 'open-folder', name: 'Ouvrir un dossier', description: 'Affiche le dossier dans la zone choisie, en laissant les autres touches en place.', defaults: { folder: '', target: 'current' }, schema: Schema.toJsonSchemaDocument(actionParameters['open-folder']), fields: [{ key: 'folder', label: 'Dossier', kind: 'folder', hint: '' }, { key: 'target', label: 'Zone du dossier', kind: 'zone', hint: 'La taille de cette zone détermine le nombre d’icônes affichées par page. Une touche est réservée au Retour.' }] },
  { id: 'go-back', name: 'Retour', description: 'Revient au dossier ou à la page précédente de cette zone.', defaults: {}, schema: Schema.toJsonSchemaDocument(actionParameters['go-back']), fields: [] },
  ...(['page-previous', 'page-next'] as const).map((id) => ({ id, name: id === 'page-next' ? 'Page suivante' : 'Page précédente', description: 'Change uniquement la page de la zone ciblée.', defaults: { target: 'current' }, schema: Schema.toJsonSchemaDocument(actionParameters[id]), fields: [{ key: 'target', label: 'Zone à paginer', kind: 'zone' as const, hint: 'Fixe cette touche pour la garder sur toutes les pages.' }] })),
];
export interface KeyState { readonly count: number; readonly status: BindingStatus; readonly detail: string }
const emptyState: KeyState = { count: 0, status: 'idle', detail: '' };

/** One scoped owner for stable shortcuts, navigation, persistence and execution. */
export const make = (deck: Device, profileFile: string, applications: ReadonlyArray<ApplicationEntry>, audioPage?: (direction: number) => Effect.Effect<void, StudioError>, pluginActions?: { validate: (plugin: string, command: string, input: unknown) => Effect.Effect<void, StudioError>; invoke: (plugin: string, command: string, input: unknown, context?: import('./plugin.ts').Invocation) => Effect.Effect<unknown, StudioError> }) => Effect.gen(function*() {
  const scope = yield* Effect.scope;
  const fs = yield* FileSystem.FileSystem; const path = yield* Path.Path;
  const commands = pluginActions ? undefined : yield* Commands.make(applications); const crypto = yield* Crypto.Crypto;
  const renderer = yield* Takumi.current; const lock = yield* Semaphore.make(1);
  const deviceKeys = deck.buttons.filter((key) => key.pixelSize).map((key) => key.index);
  const originalText = (yield* fs.exists(profileFile)) ? yield* fs.readFileString(profileFile) : undefined;
  const stored = originalText === undefined ? undefined : yield* Schema.decodeUnknownEffect(Schema.fromJsonString(StoredProfile))(originalText);
  let legacyText = stored?.version === 1 ? originalText : undefined;
  if (stored?.version === 1) for (const key of Object.keys(stored.buttons)) if (String(Number(key)) !== key || !deviceKeys.includes(Number(key))) return yield* Effect.fail(invalid('Indice de touche invalide dans le profil.'));
  const loaded: Profile = stored?.version === 2 ? stored : { version: 2, zones: [{ id: 'deck', name: 'Zone principale', keys: deviceKeys, pinned: {},
    items: deviceKeys.map((key) => stored?.version === 1 && stored.buttons[String(key)] ? { id: `legacy/${key}`, binding: stored.buttons[String(key)]! } : null),
  }], folders: [] };
  yield* checked(() => Layout.validate(loaded, deviceKeys));
  const model = yield* Ref.make({ profile: loaded, navigation: {} as Layout.Navigation, revision: 0 });
  const states = yield* Ref.make<ReadonlyMap<string, KeyState>>(new Map());
  const jobs = new Map<string, Fiber.Fiber<void, never>>(); const painted = new Map<number, string>();
  const stateFor = (entry: Entry | null, all: ReadonlyMap<string, KeyState>) => entry ? all.get(entry.id) ?? { ...emptyState, count: entry.binding.action === 'counter' ? entry.binding.parameters.start : 0 } : emptyState;
  const view = Effect.gen(function*() {
    const current = yield* Ref.get(model); const all = yield* Ref.get(states);
    const projection = Layout.project(current.profile, current.navigation, current.revision);
    return { layout: projection.layout, keys: new Map([...projection.keys].map(([key, slot]) => [key, { ...slot, state: stateFor(slot.entry, all) }])) };
  });
  const validateKey = (key: number) => deviceKeys.includes(key) ? Effect.void : Effect.fail(invalid('Cette touche n’existe pas sur le deck.'));
  const currentKey = (key: number, address?: string) => Effect.gen(function*() {
    yield* validateKey(key); const slot = (yield* view).keys.get(key)!;
    if (address !== undefined && slot.address !== address) return yield* Effect.fail(invalid('La page ou la touche a changé. Recharge la sélection avant de continuer.', 409));
    return slot;
  });
  const paint = (key: number, entry: Entry | null, state: KeyState) => Effect.gen(function*() {
    const stamp = JSON.stringify([entry, state.count, state.status]); if (painted.get(key) === stamp) return;
    if (!entry) yield* deck.key(key).clear;
    else {
      const size = deck.buttons.find((button) => button.index === key)!.pixelSize!;
      yield* deck.key(key).setImage(yield* renderer.rgb(createElement(KeyCard, { ...size, label: entry.binding.label, action: entry.binding.action, count: state.count, status: state.status }), size));
    }
    painted.set(key, stamp);
  });
  const repaint = (zone?: string, initial = false) => Effect.gen(function*() {
    for (const [key, slot] of (yield* view).keys) if ((!zone || slot.zone === zone) && (!initial || slot.entry)) yield* paint(key, slot.entry, slot.state);
  });
  const paintEntry = (id: string) => Effect.gen(function*() {
    for (const [key, slot] of (yield* view).keys) if (slot.entry?.id === id) yield* paint(key, slot.entry, slot.state);
  });
  const setState = (id: string, state: KeyState) => Ref.update(states, (before) => new Map([...before, [id, state]]));
  const commit = (next: Profile, navigation: Layout.Navigation) => Effect.gen(function*() {
    const compact = Layout.copy(next);
    for (const owner of [...compact.zones, ...compact.folders]) while (owner.items.at(-1) === null) owner.items.pop();
    const validated = yield* Schema.decodeUnknownEffect(Profile)(compact);
    yield* checked(() => Layout.validate(validated, deviceKeys));
    yield* fs.makeDirectory(path.dirname(profileFile), { recursive: true });
    if (legacyText !== undefined && !(yield* fs.exists(`${profileFile}.v1.backup`))) yield* fs.writeFileString(`${profileFile}.v1.backup`, legacyText, { mode: 0o600 });
    const temporary = `${profileFile}.${yield* crypto.randomUUIDv4()}.tmp`;
    yield* Effect.gen(function*() {
      yield* fs.writeFileString(temporary, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 });
      yield* fs.rename(temporary, profileFile);
      yield* Ref.update(model, (before) => ({ profile: validated, navigation, revision: before.revision + 1 })); legacyText = undefined;
    }).pipe(Effect.uninterruptible, Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.ignore)));
  });
  const navigateUnlocked = (command: Navigate) => Effect.gen(function*() {
    const before = yield* Ref.get(model); const navigation = yield* checked(() => Layout.navigate(before.profile, before.navigation, command));
    yield* Ref.set(model, { ...before, navigation, revision: before.revision + 1 }); yield* repaint(command.zone);
  });
  const save = (key: number, input: unknown, expected?: ButtonBinding | null, address?: string) => Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
    const slot = yield* currentKey(key, address);
    if (slot.virtual) return yield* Effect.fail(invalid('La touche Retour du dossier est réservée.'));
    if (slot.state.status === 'running') return yield* Effect.fail(invalid('Une commande est en cours sur cette touche.', 409));
    if (expected !== undefined && JSON.stringify(slot.entry?.binding ?? null) !== JSON.stringify(expected)) return yield* Effect.fail(invalid('Cette affectation a changé dans un autre éditeur. Recharge la touche avant d’enregistrer.', 409));
    const binding = input === null ? undefined : yield* Schema.decodeUnknownEffect(ButtonBinding)(input);
    if (binding?.action === 'launch-app' && !applications.some((app) => app.id === binding.parameters.application)) return yield* Effect.fail(invalid('Application introuvable. Choisis une application dans la liste.'));
    if (binding?.action === 'plugin') yield* pluginActions?.validate(binding.parameters.plugin, binding.parameters.command, binding.parameters.input) ?? Effect.fail(invalid('Les actions de plugins ne sont pas disponibles.'));
    const before = yield* Ref.get(model); const next = Layout.copy(before.profile);
    const entry = binding ? { id: slot.entry?.id ?? (yield* crypto.randomUUIDv4()), binding } : null;
    yield* checked(() => Layout.replace(next, before.navigation, key, entry));
    yield* commit(next, before.navigation);
    if (entry) yield* setState(entry.id, { ...emptyState, count: entry.binding.action === 'counter' ? entry.binding.parameters.start : 0 });
    yield* repaint(slot.zone);
  }));
  const organize = (command: Organize) => Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
    const before = yield* Ref.get(model);
    if ('revision' in command && command.revision !== before.revision) return yield* Effect.fail(invalid('La disposition a changé. Recharge-la avant de continuer.', 409));
    const next = Layout.copy(before.profile); let navigation = before.navigation;
    if (command.operation === 'create-folder') {
      const slot = yield* currentKey(command.key, command.address);
      if (slot.entry || slot.virtual) return yield* Effect.fail(invalid('Sélectionne une touche libre pour créer un dossier.'));
      const id = yield* crypto.randomUUIDv4(); next.folders.push({ id, name: command.name, items: [] });
      const entryId = yield* crypto.randomUUIDv4();
      yield* checked(() => Layout.replace(next, navigation, command.key, { id: entryId, binding: { label: command.name, action: 'open-folder', parameters: { folder: id, target: command.target ?? 'current' } } }));
    } else if (command.operation === 'move') yield* checked(() => Layout.move(next, command.id, command.destination));
    else if (command.operation === 'create-zone') { const id = yield* crypto.randomUUIDv4(); yield* checked(() => Layout.createZone(next, id, command.name, command.keys)); }
    else if (command.operation === 'resize-zone') {
      yield* checked(() => Layout.resizeZone(next, command.zone, command.keys));
      navigation = Layout.navigate(next, navigation, { zone: 'deck', operation: 'root' });
      navigation = Layout.navigate(next, navigation, { zone: command.zone, operation: 'root' });
    }
    else if (command.operation === 'rename-folder') {
      const folder = next.folders.find((folder) => folder.id === command.id);
      if (!folder) return yield* Effect.fail(invalid('Dossier introuvable.')); folder.name = command.name;
      for (const entry of Layout.entries(next)) if (entry.binding.action === 'open-folder' && entry.binding.parameters.folder === folder.id) {
        const replacement = { ...entry, binding: { ...entry.binding, label: command.name } }; // Keep folder tiles named after their destination.
        for (const owner of [...next.zones, ...next.folders]) for (const [i, item] of owner.items.entries()) if (item?.id === entry.id) owner.items[i] = replacement;
        for (const zone of next.zones) for (const [key, item] of Object.entries(zone.pinned)) if (item.id === entry.id) zone.pinned[key] = replacement;
      }
    } else if (command.operation === 'pin') {
      const slot = yield* currentKey(command.key, command.address);
      if (!slot.entry || slot.virtual) return yield* Effect.fail(invalid('Choisis un raccourci pour le fixer.'));
      const zone = next.zones.find((zone) => zone.id === slot.zone)!;
      if (command.value && !slot.pinned) { yield* checked(() => Layout.replace(next, navigation, command.key, null)); zone.pinned[String(command.key)] = slot.entry; }
      else if (!command.value && slot.pinned) { delete zone.pinned[String(command.key)]; const items = Layout.container(next, zone.id, Layout.position(navigation, zone.id).folder).items as Array<Entry | null>; const hole = items.indexOf(null); if (hole < 0) items.push(slot.entry); else items[hole] = slot.entry; }
    } else {
      const zone = next.zones.find((zone) => zone.id === command.zone);
      if (!zone) return yield* Effect.fail(invalid('Zone introuvable.'));
      const current = Layout.position(navigation, zone.id); const size = Layout.capacity(zone, current.folder);
      if (size < 1) return yield* Effect.fail(invalid('Cette zone n’a pas de place disponible.'));
      const owner = Layout.container(next, zone.id, current.folder) as Layout.MutableProfile['folders'][number];
      const page = Layout.pageCount(next, zone, current.folder); owner.minimumPages = page + 1;
      navigation = { ...navigation, [zone.id]: { ...current, page } };
    }
    yield* commit(next, navigation); yield* repaint();
  }));
  const press = (key: number, address?: string) => Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
    const slot = yield* currentKey(key, address); const entry = slot.entry; if (!entry) return;
    const binding = entry.binding; const state = slot.state;
    if (binding.action === 'open-folder') return yield* navigateUnlocked({ zone: !binding.parameters.target || binding.parameters.target === 'current' ? slot.zone : binding.parameters.target, operation: 'open', folder: binding.parameters.folder });
    if (binding.action === 'go-back') return yield* navigateUnlocked({ zone: slot.zone, operation: 'back' });
    if (binding.action === 'page-next' || binding.action === 'page-previous') {
      const direction = binding.action === 'page-next' ? 1 : -1;
      if (binding.parameters.target === 'audio') return yield* (audioPage?.(direction) ?? Effect.fail(invalid('Le mixer audio n’est pas disponible.')));
      return yield* navigateUnlocked({ zone: binding.parameters.target === 'current' ? slot.zone : binding.parameters.target, operation: direction === 1 ? 'next' : 'previous' });
    }
    if (state.status === 'running') return yield* Effect.fail(invalid('Cette commande est déjà en cours.', 409));
    if (binding.action === 'counter') { yield* setState(entry.id, { ...state, count: state.count + 1, status: 'success' }); yield* paintEntry(entry.id); return; }
    yield* setState(entry.id, { ...state, status: 'running', detail: '' }); yield* paintEntry(entry.id);
    const job = Effect.scoped(Effect.gen(function*() {
      const output = (text: string) => Ref.update(states, (all) => {
        const current = all.get(entry.id) ?? state; return new Map([...all, [entry.id, { ...current, detail: (current.detail + text).slice(-4096) }]]);
      });
      const context = { output };
      const result = binding.action === 'plugin'
        ? yield* pluginActions?.invoke(binding.parameters.plugin, binding.parameters.command, binding.parameters.input, context) ?? Effect.fail(invalid('Les actions de plugins ne sont pas disponibles.'))
        : pluginActions ? yield* pluginActions.invoke('commands', binding.action, binding.parameters, context) : yield* commands!.run(binding.action, binding.parameters, output);
      const detail = yield* Effect.try({ try: () => (typeof result === 'string' ? result : result === undefined ? 'Action terminée.' : JSON.stringify(result) ?? String(result)).slice(-4096), catch: () => invalid('Le résultat de l’action n’est pas sérialisable.') });
      yield* Ref.update(states, (all) => { const current = all.get(entry.id) ?? state; return new Map([...all, [entry.id, { ...current, detail }]]); });
    })).pipe(Effect.matchEffect({
      onSuccess: () => Semaphore.withPermits(lock, 1)(Effect.gen(function*() { const current = (yield* Ref.get(states)).get(entry.id) ?? state; yield* setState(entry.id, { ...current, status: 'success' }); yield* paintEntry(entry.id); })),
      onFailure: (error) => Semaphore.withPermits(lock, 1)(Effect.gen(function*() { const current = (yield* Ref.get(states)).get(entry.id) ?? state; yield* setState(entry.id, { ...current, status: 'error', detail: `${current.detail}\n${error.message}`.trim().slice(-4096) }); yield* paintEntry(entry.id); })),
    }), Effect.catch((error) => Effect.logError('Action feedback failed', error)));
    jobs.set(entry.id, yield* Effect.forkIn(job, scope));
  }));
  const cancel = (key: number, address?: string) => Effect.gen(function*() {
    const slot = yield* Semaphore.withPermits(lock, 1)(currentKey(key, address)); if (!slot.entry) return;
    const id = slot.entry.id; const fiber = jobs.get(id); if (fiber) yield* Fiber.interrupt(fiber);
    yield* Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
      if (jobs.get(id) !== fiber) return; const state = (yield* Ref.get(states)).get(id);
      if (state?.status !== 'running') return;
      yield* setState(id, { ...state, status: 'idle', detail: 'Commande arrêtée.' }); yield* paintEntry(id);
    }));
  });
  yield* repaint(undefined, stored?.version !== 2);
  return { profile: Effect.map(Ref.get(model), (model) => model.profile), states: Effect.map(view, (view) => new Map([...view.keys].map(([key, slot]) => [key, slot.state]))),
    entryStates: Ref.get(states), view, save, press, cancel, organize, navigate: (command: Navigate) => Semaphore.withPermits(lock, 1)(navigateUnlocked(command)) };
});
