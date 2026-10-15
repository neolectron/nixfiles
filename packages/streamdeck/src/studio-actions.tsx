import type * as Overlays from './deck-overlays.ts';
import { PersistentState } from '@nixfiles/system-control/persistent-state.ts';
import { StateStorage } from '@nixfiles/system-control/state-storage.ts';
import * as FileStorage from '@nixfiles/system-control/state-storage-file.ts';
import { invariant } from './errors.ts';
import {
  Crypto,
  Deferred,
  Effect,
  Equal,
  Fiber,
  Layer,
  Path,
  Ref,
  Schema,
  Semaphore,
} from 'effect';
import * as Commands from './plugins/commands.ts';
import { StudioError } from './studio-errors.ts';
import {
  ButtonBinding,
  Profile,
  StoredProfile,
  Navigation as NavigationSchema,
  actionParameters,
  type ActionDefinition,
  type ApplicationEntry,
  type BindingStatus,
  type Entry,
  type Navigate,
  type Organize,
} from './studio-contract.ts';
import * as Layout from './studio-layout.ts';
import type { Device } from './stream-deck.ts';
import * as Takumi from './takumi.ts';
import { KeyCard } from './ui/key-card.tsx';
import type { KeyFeedback } from './key-feedback.ts';
import { mergeDiscordActions, mergeOpenAIActions } from './studio-profile-migrations.ts';
import * as Input from './studio-input.ts';
const invalid = (message: string, status = 400) => new StudioError({ message, status });
const checked = <A,>(run: () => A) =>
  Effect.try({
    try: run,
    catch: (error) => invalid(error instanceof Error ? error.message : 'Organisation invalide.'),
  });
export const catalogue: ReadonlyArray<ActionDefinition> = [
  {
    id: 'plugin',
    name: 'Action d’un plugin',
    description: 'Exécute une action déclarée par un plugin, avec ses paramètres validés.',
    defaults: { plugin: '', command: '', input: {} },
    schema: Schema.toJsonSchemaDocument(actionParameters.plugin),
    fields: [],
  },
  {
    id: 'launch-app',
    name: 'Lancer une application',
    description: 'Ouvre une application installée sur ce bureau.',
    defaults: { application: '' },
    schema: Schema.toJsonSchemaDocument(actionParameters['launch-app']),
    fields: [{ key: 'application', label: 'Application', kind: 'app', hint: '' }],
  },
  {
    id: 'run-command',
    name: 'Exécuter une commande',
    description: 'Lance un exécutable ou un script avec ses arguments.',
    defaults: { executable: '', arguments: [], directory: '' },
    schema: Schema.toJsonSchemaDocument(actionParameters['run-command']),
    fields: [
      {
        key: 'executable',
        label: 'Exécutable ou script',
        kind: 'text',
        hint: 'Un nom disponible dans PATH ou un chemin absolu.',
      },
      {
        key: 'arguments',
        label: 'Arguments',
        kind: 'arguments',
        hint: 'Un argument par ligne, transmis tel quel.',
      },
      {
        key: 'directory',
        label: 'Dossier de travail',
        kind: 'text',
        hint: 'Facultatif. Par défaut, le dossier du moteur.',
      },
    ],
  },
  {
    id: 'counter',
    name: 'Compteur',
    description: 'Incrémente une valeur sur la touche pour tester un comportement.',
    defaults: { start: 0 },
    schema: Schema.toJsonSchemaDocument(actionParameters.counter),
    fields: [{ key: 'start', label: 'Valeur de départ', kind: 'number', hint: '' }],
  },
  {
    id: 'open-folder',
    name: 'Ouvrir un dossier',
    description:
      'Affiche le dossier dans la zone choisie, en laissant les autres touches en place.',
    defaults: { folder: '', target: 'current' },
    schema: Schema.toJsonSchemaDocument(actionParameters['open-folder']),
    fields: [
      { key: 'folder', label: 'Dossier', kind: 'folder', hint: '' },
      {
        key: 'target',
        label: 'Zone du dossier',
        kind: 'zone',
        hint: 'La taille de cette zone détermine le nombre d’icônes affichées par page. Une touche est réservée au Retour.',
      },
    ],
  },
  {
    id: 'go-back',
    name: 'Retour',
    description: 'Revient au dossier ou à la page précédente de cette zone.',
    defaults: {},
    schema: Schema.toJsonSchemaDocument(actionParameters['go-back']),
    fields: [],
  },
  ...(['page-previous', 'page-next'] as const).map((id) => ({
    id,
    name: id === 'page-next' ? 'Page suivante' : 'Page précédente',
    description: 'Change uniquement la page de la zone ciblée.',
    defaults: { target: 'current' },
    schema: Schema.toJsonSchemaDocument(actionParameters[id]),
    fields: [
      {
        key: 'target',
        label: 'Zone à paginer',
        kind: 'zone' as const,
        hint: 'Fixe cette touche pour la garder sur toutes les pages.',
      },
    ],
  })),
];
export interface KeyState {
  readonly count: number;
  readonly status: BindingStatus;
  readonly detail: string;
  readonly feedback?: KeyFeedback | null;
}
const emptyState: KeyState = { count: 0, status: 'idle', detail: '' };
/** One scoped owner for stable shortcuts, navigation, persistence and execution. */
export const makeWithState = (
  deck: Device,
  profileFile: string,
  applications: ReadonlyArray<ApplicationEntry>,
  audioPage?: (direction: number) => Effect.Effect<void, StudioError>,
  pluginActions?: {
    validate: (plugin: string, command: string, input: unknown) => Effect.Effect<void, StudioError>;
    invoke: (
      plugin: string,
      command: string,
      input: unknown,
      context?: import('./plugin.ts').Invocation,
    ) => Effect.Effect<unknown, StudioError>;
    feedback?: (
      plugin: string,
      command: string,
      input: unknown,
    ) => Effect.Effect<KeyFeedback | null>;
    interaction?: (plugin: string, command: string) => Effect.Effect<'press' | 'hold'>;
  },
  overlays?: Effect.Success<ReturnType<typeof Overlays.make>>,
) =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const path = yield* Path.Path;
    const storage = yield* StateStorage;
    const profileKey = path.basename(profileFile);
    const profileDocument = (yield* PersistentState).document(profileKey, Profile);
    const commands = pluginActions ? undefined : yield* Commands.make(applications);
    const crypto = yield* Crypto.Crypto;
    const renderer = yield* Takumi.current;
    const lock = yield* Semaphore.make(1);
    const deviceKeys = deck.buttons.filter((key) => key.pixelSize).map((key) => key.index);
    const originalText = yield* storage.get(profileKey);
    const stored =
      originalText === undefined
        ? undefined
        : yield* Schema.decodeUnknownEffect(Schema.fromJsonString(StoredProfile))(originalText);
    let legacyText = stored?.version === 1 ? originalText : undefined;
    if (stored?.version === 1)
      for (const key of Object.keys(stored.buttons))
        if (String(Number(key)) !== key || !deviceKeys.includes(Number(key)))
          return yield* Effect.fail(invalid('Indice de touche invalide dans le profil.'));
    const originalProfile: Profile =
      stored?.version === 2
        ? stored
        : {
            version: 2,
            zones: [
              {
                id: 'deck',
                name: 'Zone principale',
                keys: deviceKeys,
                pinned: {},
                items: deviceKeys.map((key) =>
                  stored?.version === 1 && stored.buttons[String(key)]
                    ? {
                        id: `legacy/${key}`,
                        binding: invariant(stored.buttons[String(key)], 'studio-actions'),
                      }
                    : null,
                ),
              },
            ],
            folders: [],
          };
    const discordProfile = mergeDiscordActions(originalProfile);
    let previousDiscordText = discordProfile !== originalProfile ? originalText : undefined;
    const loaded = mergeOpenAIActions(discordProfile);
    let previousDotText = loaded !== discordProfile ? originalText : undefined;
    yield* checked(() => Layout.validate(loaded, deviceKeys));
    const model = yield* Ref.make({
      profile: loaded,
      configurationRevision: 0,
      navigation: {} as Layout.Navigation,
      revision: 0,
    });
    const states = yield* Ref.make<ReadonlyMap<string, KeyState>>(new Map());
    const feedbacks = yield* Ref.make<ReadonlyMap<string, KeyFeedback | null>>(new Map());
    let feedbackReady = false;
    const jobs = new Map<string, Fiber.Fiber<void, never>>();
    const painted = new Map<number, string>();
    const releases = new Map<
      number,
      {
        readonly waiter: Deferred.Deferred<void>;
        readonly cancelled: Deferred.Deferred<void>;
        readonly address: string;
        readonly revision: number | undefined;
        readonly source: string;
      }
    >();
    const validateTrigger = (binding: ButtonBinding) =>
      Effect.gen(function* () {
        if (
          binding.trigger?.type === 'double-tap' &&
          binding.action === 'plugin' &&
          (yield* (
            pluginActions?.interaction?.(binding.parameters.plugin, binding.parameters.command) ??
              Effect.succeed('press')
          )) === 'hold'
        )
          return yield* Effect.fail(
            invalid(
              'Une action à maintenir accepte l’appui simple ou long, mais pas le double appui.',
            ),
          );
      });
    const stateFor = (entry: Entry | null, all: ReadonlyMap<string, KeyState>) =>
      entry
        ? (all.get(entry.id) ?? {
            ...emptyState,
            count: entry.binding.action === 'counter' ? entry.binding.parameters.start : 0,
          })
        : emptyState;
    const view = Effect.gen(function* () {
      const current = yield* Ref.get(model);
      const all = yield* Ref.get(states);
      const feedback = yield* Ref.get(feedbacks);
      const overlay = yield* (
        overlays?.snapshot ??
          Effect.succeed({ revision: 0, keys: new Map<number, Overlays.Claim>() })
      );
      const projection = Layout.project(
        current.profile,
        current.navigation,
        current.revision + overlay.revision,
      );
      const projectedKeys = new Map(
        [...projection.keys].map(([key, slot]) => {
          const claim = overlay.keys.get(key);
          return [
            key,
            claim
              ? {
                  ...slot,
                  entry: claim.entry,
                  address: claim.address,
                  virtual: false,
                  overlay: { owner: claim.owner, id: claim.id, name: claim.name },
                }
              : { ...slot, overlay: undefined },
          ];
        }),
      );
      return {
        configuration: {
          profile: current.profile,
          navigation: current.navigation,
          revision: current.configurationRevision,
        },
        layout: projection.layout,
        keys: new Map(
          [...projectedKeys].map(([key, slot]) => [
            key,
            {
              ...slot,
              state: {
                ...stateFor(slot.entry, all),
                feedback: slot.entry ? (feedback.get(slot.entry.id) ?? null) : null,
              },
            },
          ]),
        ),
      };
    });
    const validateKey = (key: number) =>
      deviceKeys.includes(key)
        ? Effect.void
        : Effect.fail(invalid('Cette touche n’existe pas sur le deck.'));
    const currentKey = (key: number, address?: string) =>
      Effect.gen(function* () {
        yield* validateKey(key);
        const slot = invariant((yield* view).keys.get(key), 'studio-actions');
        if (address !== undefined && slot.address !== address)
          return yield* Effect.fail(
            invalid(
              'La page ou la touche a changé. Recharge la sélection avant de continuer.',
              409,
            ),
          );
        return slot;
      });
    const paint = (key: number, entry: Entry | null, state: KeyState) =>
      Effect.gen(function* () {
        const binding = entry?.binding;
        const feedback =
          feedbackReady && binding?.action === 'plugin' && pluginActions?.feedback
            ? yield* pluginActions.feedback(
                binding.parameters.plugin,
                binding.parameters.command,
                binding.parameters.input,
              )
            : null;
        const stamp = JSON.stringify([entry, state.count, state.status, feedback]);
        if (painted.get(key) === stamp) return;
        if (!entry) yield* deck.key(key).clear;
        else {
          const size = invariant(
            invariant(
              deck.buttons.find((button) => button.index === key),
              'studio-actions',
            ).pixelSize,
            'studio-actions',
          );
          yield* deck
            .key(key)
            .setImage(
              yield* renderer.rgb(
                <KeyCard
                  {...size}
                  label={entry.binding.label}
                  action={entry.binding.action}
                  count={state.count}
                  status={state.status}
                  feedback={feedback}
                />,
                size,
              ),
            );
        }
        painted.set(key, stamp);
        if (entry)
          yield* Ref.update(feedbacks, (before) => new Map([...before, [entry.id, feedback]]));
      });
    const repaint = (zone?: string, initial = false) =>
      Effect.gen(function* () {
        for (const [key, slot] of (yield* view).keys)
          if ((!zone || slot.zone === zone) && (!initial || slot.entry))
            yield* paint(key, slot.entry, slot.state);
      });
    const paintEntry = (id: string) =>
      Effect.gen(function* () {
        for (const [key, slot] of (yield* view).keys)
          if (slot.entry?.id === id) yield* paint(key, slot.entry, slot.state);
      });
    const setState = (id: string, state: KeyState) =>
      Ref.update(states, (before) => new Map([...before, [id, state]]));
    const commit = (next: Profile, navigation: Layout.Navigation) =>
      Effect.gen(function* () {
        const compact = Layout.copy(next);
        for (const owner of [...compact.zones, ...compact.folders])
          while (owner.items.at(-1) === null) owner.items.pop();
        const validated = yield* Schema.decodeUnknownEffect(Profile)(compact);
        yield* checked(() => Layout.validate(validated, deviceKeys));
        if (
          legacyText !== undefined &&
          (yield* storage.get(`${profileKey}.v1.backup`)) === undefined
        )
          yield* storage.set(`${profileKey}.v1.backup`, legacyText);
        if (
          previousDiscordText !== undefined &&
          (yield* storage.get(`${profileKey}.discord-share.backup`)) === undefined
        )
          yield* storage.set(`${profileKey}.discord-share.backup`, previousDiscordText);
        if (
          previousDotText !== undefined &&
          (yield* storage.get(`${profileKey}.dot-voice.backup`)) === undefined
        )
          yield* storage.set(`${profileKey}.dot-voice.backup`, previousDotText);
        yield* Effect.gen(function* () {
          yield* profileDocument.set(validated);
          yield* Ref.update(model, (before) => ({
            profile: validated,
            navigation,
            revision: before.revision + 1,
            configurationRevision: before.configurationRevision + 1,
          }));
          legacyText = undefined;
          previousDiscordText = undefined;
          previousDotText = undefined;
        }).pipe(Effect.uninterruptible);
      });
    const navigateUnlocked = (command: Navigate) =>
      Effect.gen(function* () {
        const before = yield* Ref.get(model);
        const navigation = yield* checked(() =>
          Layout.navigate(before.profile, before.navigation, command),
        );
        yield* Ref.set(model, { ...before, navigation, revision: before.revision + 1 });
        yield* repaint(command.zone);
      });
    const save = (key: number, input: unknown, expected?: ButtonBinding | null, address?: string) =>
      Semaphore.withPermits(
        lock,
        1,
      )(
        Effect.gen(function* () {
          const slot = yield* currentKey(key, address);
          if (slot.overlay)
            return yield* Effect.fail(
              invalid('Cette touche est fournie par un overlay temporaire.', 409),
            );
          if (slot.virtual)
            return yield* Effect.fail(invalid('La touche Retour du dossier est réservée.'));
          if (slot.state.status === 'running')
            return yield* Effect.fail(invalid('Une commande est en cours sur cette touche.', 409));
          if (
            expected !== undefined &&
            JSON.stringify(slot.entry?.binding ?? null) !== JSON.stringify(expected)
          )
            return yield* Effect.fail(
              invalid(
                'Cette affectation a changé dans un autre éditeur. Recharge la touche avant d’enregistrer.',
                409,
              ),
            );
          const binding =
            input === null ? undefined : yield* Schema.decodeUnknownEffect(ButtonBinding)(input);
          if (binding) yield* validateTrigger(binding);
          if (
            binding?.action === 'launch-app' &&
            !applications.some((app) => app.id === binding.parameters.application)
          )
            return yield* Effect.fail(
              invalid('Application introuvable. Choisis une application dans la liste.'),
            );
          if (binding?.action === 'plugin')
            yield* (
              pluginActions?.validate(
                binding.parameters.plugin,
                binding.parameters.command,
                binding.parameters.input,
              ) ?? Effect.fail(invalid('Les actions de plugins ne sont pas disponibles.'))
            );
          const before = yield* Ref.get(model);
          const next = Layout.copy(before.profile);
          const entry = binding
            ? { id: slot.entry?.id ?? (yield* crypto.randomUUIDv4()), binding }
            : null;
          yield* checked(() => Layout.replace(next, before.navigation, key, entry));
          yield* commit(next, before.navigation);
          if (entry)
            yield* setState(entry.id, {
              ...emptyState,
              count: entry.binding.action === 'counter' ? entry.binding.parameters.start : 0,
            });
          yield* repaint(slot.zone);
        }),
      );
    const saveProfile = (
      input: unknown,
      navigation: Layout.Navigation,
      expectedRevision: number,
      expectedProfile?: Profile,
    ) =>
      Semaphore.withPermits(
        lock,
        1,
      )(
        Effect.gen(function* () {
          const before = yield* Ref.get(model);
          if (
            before.configurationRevision !== expectedRevision ||
            (expectedProfile && !Equal.equals(before.profile, expectedProfile))
          )
            return yield* Effect.fail(
              invalid(
                'La configuration a changé dans un autre éditeur. Annule ou recharge avant d’enregistrer.',
                409,
              ),
            );
          const next = yield* Schema.decodeUnknownEffect(Profile)(input);
          yield* checked(() => Layout.validate(next, deviceKeys));
          const validatedNavigation =
            yield* Schema.decodeUnknownEffect(NavigationSchema)(navigation);
          yield* checked(() => Layout.validateNavigation(next, validatedNavigation));
          if (jobs.size || releases.size)
            return yield* Effect.fail(
              invalid(
                'Relâche les touches et arrête les actions en cours avant d’enregistrer.',
                409,
              ),
            );
          const previousEntries = new Map(
            Layout.entries(before.profile).map((entry) => [entry.id, entry]),
          );
          const changed = Layout.entries(next).filter(
            (entry) =>
              JSON.stringify(entry.binding) !==
              JSON.stringify(previousEntries.get(entry.id)?.binding),
          );
          for (const { binding } of changed) {
            yield* validateTrigger(binding);
            if (
              binding.action === 'launch-app' &&
              !applications.some((app) => app.id === binding.parameters.application)
            )
              return yield* Effect.fail(
                invalid('Application introuvable. Choisis une application dans la liste.'),
              );
            if (binding.action === 'plugin')
              yield* (
                pluginActions?.validate(
                  binding.parameters.plugin,
                  binding.parameters.command,
                  binding.parameters.input,
                ) ?? Effect.fail(invalid('Les actions de plugins ne sont pas disponibles.'))
              );
          }
          yield* commit(next, validatedNavigation);
          for (const entry of changed)
            yield* setState(entry.id, {
              ...emptyState,
              count: entry.binding.action === 'counter' ? entry.binding.parameters.start : 0,
            });
          yield* repaint();
        }),
      );
    const organize = (command: Organize) =>
      Semaphore.withPermits(
        lock,
        1,
      )(
        Effect.gen(function* () {
          const before = yield* Ref.get(model);
          if ('revision' in command && command.revision !== before.revision)
            return yield* Effect.fail(
              invalid('La disposition a changé. Recharge-la avant de continuer.', 409),
            );
          if (command.operation === 'exchange') {
            const from = yield* currentKey(command.source, command.sourceAddress);
            const to = yield* currentKey(command.target, command.targetAddress);
            if (from.overlay || to.overlay)
              return yield* Effect.fail(
                invalid(
                  'Les touches d’un overlay ne peuvent pas être déplacées dans le profil.',
                  409,
                ),
              );
            const active = yield* Ref.get(states);
            if (
              [from, to].some(
                (slot) => slot.entry && active.get(slot.entry.id)?.status === 'running',
              ) ||
              releases.has(command.source) ||
              releases.has(command.target)
            )
              return yield* Effect.fail(
                invalid('Relâche les touches et arrête leurs actions avant de les déplacer.', 409),
              );
            if (command.source === command.target || from.entry?.id === to.entry?.id) return;
          }
          const next = Layout.copy(before.profile);
          const ids = {
            entry: yield* crypto.randomUUIDv4(),
            folder: yield* crypto.randomUUIDv4(),
            zone: yield* crypto.randomUUIDv4(),
          };
          const navigation = yield* checked(() =>
            Layout.organize(next, before.navigation, command, ids),
          );
          yield* commit(next, navigation);
          yield* repaint();
        }),
      );
    const press = (
      key: number,
      address?: string,
      expected?: {
        binding: ButtonBinding;
        revision: number;
        source: string;
      },
    ) =>
      Semaphore.withPermits(
        lock,
        1,
      )(
        Effect.gen(function* () {
          const slot = yield* currentKey(key, expected === undefined ? address : undefined);
          const entry = slot.entry;
          if (!entry) return;
          if (
            expected &&
            (slot.address !== address ||
              JSON.stringify(entry.binding) !== JSON.stringify(expected.binding) ||
              (yield* view).layout.revision !== expected.revision)
          )
            return;
          if (releases.has(key))
            return yield* Effect.fail(
              invalid('Relâche d’abord l’action en cours sur cette touche.', 409),
            );
          const binding = entry.binding;
          const state = slot.state;
          if (binding.action === 'open-folder')
            return yield* navigateUnlocked({
              zone:
                !binding.parameters.target || binding.parameters.target === 'current'
                  ? slot.zone
                  : binding.parameters.target,
              operation: 'open',
              folder: binding.parameters.folder,
            });
          if (binding.action === 'go-back')
            return yield* navigateUnlocked({ zone: slot.zone, operation: 'back' });
          if (binding.action === 'page-next' || binding.action === 'page-previous') {
            const direction = binding.action === 'page-next' ? 1 : -1;
            if (binding.parameters.target === 'audio')
              return yield* (
                audioPage?.(direction) ??
                  Effect.fail(invalid('Le mixer audio n’est pas disponible.'))
              );
            return yield* navigateUnlocked({
              zone: binding.parameters.target === 'current' ? slot.zone : binding.parameters.target,
              operation: direction === 1 ? 'next' : 'previous',
            });
          }
          if (state.status === 'running')
            return yield* Effect.fail(invalid('Cette commande est déjà en cours.', 409));
          if (binding.action === 'counter') {
            yield* setState(entry.id, { ...state, count: state.count + 1, status: 'success' });
            yield* paintEntry(entry.id);
            return;
          }
          yield* setState(entry.id, { ...state, status: 'running', detail: '' });
          yield* paintEntry(entry.id);
          const released = yield* Deferred.make<void>();
          const cancelled = yield* Deferred.make<void>();
          releases.set(key, {
            waiter: released,
            cancelled,
            address: slot.address,
            revision: expected?.revision,
            source: expected?.source ?? 'direct',
          });
          const job = Effect.scoped(
            Effect.gen(function* () {
              const output = (text: string) =>
                Ref.update(states, (all) => {
                  const current = all.get(entry.id) ?? state;
                  return new Map([
                    ...all,
                    [entry.id, { ...current, detail: (current.detail + text).slice(-4096) }],
                  ]);
                });
              const context = {
                output,
                released: Deferred.await(released),
                cancelled: Deferred.await(cancelled),
                gesture: binding.trigger?.type ?? ('press' as const),
              };
              const result =
                binding.action === 'plugin'
                  ? yield* (
                      pluginActions?.invoke(
                        binding.parameters.plugin,
                        binding.parameters.command,
                        binding.parameters.input,
                        context,
                      ) ?? Effect.fail(invalid('Les actions de plugins ne sont pas disponibles.'))
                    )
                  : pluginActions
                    ? yield* pluginActions.invoke(
                        'commands',
                        binding.action,
                        binding.parameters,
                        context,
                      )
                    : yield* invariant(commands, 'studio-actions').run(
                        binding.action,
                        binding.parameters,
                        output,
                      );
              const detail = yield* Effect.try({
                try: () =>
                  (typeof result === 'string'
                    ? result
                    : result === undefined
                      ? 'Action terminée.'
                      : (JSON.stringify(result) ?? String(result))
                  ).slice(-4096),
                catch: () => invalid('Le résultat de l’action n’est pas sérialisable.'),
              });
              yield* Ref.update(states, (all) => {
                const current = all.get(entry.id) ?? state;
                return new Map([...all, [entry.id, { ...current, detail }]]);
              });
            }),
          ).pipe(
            Effect.matchEffect({
              onSuccess: () =>
                Semaphore.withPermits(
                  lock,
                  1,
                )(
                  Effect.gen(function* () {
                    const current = (yield* Ref.get(states)).get(entry.id) ?? state;
                    yield* setState(entry.id, { ...current, status: 'success' });
                    yield* paintEntry(entry.id);
                  }),
                ),
              onFailure: (error) =>
                Semaphore.withPermits(
                  lock,
                  1,
                )(
                  Effect.gen(function* () {
                    const current = (yield* Ref.get(states)).get(entry.id) ?? state;
                    yield* setState(entry.id, {
                      ...current,
                      status: 'error',
                      detail: `${current.detail}\n${error.message}`.trim().slice(-4096),
                    });
                    yield* paintEntry(entry.id);
                  }),
                ),
            }),
            Effect.catch((error) => Effect.logError('Action feedback failed', error)),
            Effect.ensuring(
              Effect.sync(() => {
                if (releases.get(key)?.waiter === released) releases.delete(key);
              }),
            ),
          );
          jobs.set(entry.id, yield* Effect.forkIn(job, scope));
        }),
      );
    const cancel = (key: number, address?: string) =>
      Effect.gen(function* () {
        const slot = yield* Semaphore.withPermits(lock, 1)(currentKey(key, address));
        if (!slot.entry) return;
        const id = slot.entry.id;
        const fiber = jobs.get(id);
        if (fiber) yield* Fiber.interrupt(fiber);
        yield* Semaphore.withPermits(
          lock,
          1,
        )(
          Effect.gen(function* () {
            if (jobs.get(id) !== fiber) return;
            const state = (yield* Ref.get(states)).get(id);
            if (state?.status !== 'running') return;
            yield* setState(id, { ...state, status: 'idle', detail: 'Commande arrêtée.' });
            yield* paintEntry(id);
          }),
        );
      });
    yield* repaint(undefined, stored?.version !== 2);
    feedbackReady = true;
    const release = (
      key: number,
      address?: string,
      revision?: number,
      source?: string,
      cancelled = false,
    ) =>
      Effect.suspend(() => {
        const pending = releases.get(key);
        if (
          !pending ||
          (source !== undefined && source !== pending.source) ||
          (address !== undefined && address !== pending.address) ||
          (revision !== undefined &&
            pending.revision !== undefined &&
            revision !== pending.revision)
        )
          return Effect.void;
        releases.delete(key);
        return (cancelled ? Deferred.succeed(pending.cancelled, undefined) : Effect.void).pipe(
          Effect.andThen(Deferred.succeed(pending.waiter, undefined)),
          Effect.asVoid,
        );
      });
    const input = yield* Input.make({
      validateKey,
      validate: validateTrigger,
      release,
      resolve: (key, address) =>
        Semaphore.withPermits(
          lock,
          1,
        )(
          Effect.gen(function* () {
            const slot = yield* currentKey(key, address);
            return slot.entry
              ? {
                  binding: slot.entry.binding,
                  address: slot.address,
                  revision: (yield* view).layout.revision,
                }
              : undefined;
          }),
        ),
      press: (key, activation, source) =>
        press(key, activation.address, {
          binding: activation.binding,
          revision: activation.revision,
          source,
        }),
    });
    let paintedOverlayRevision = -1;
    return {
      profile: Effect.map(Ref.get(model), (candidateModel) => candidateModel.profile),
      states: Effect.map(
        view,
        (candidateView) => new Map([...candidateView.keys].map(([key, slot]) => [key, slot.state])),
      ),
      entryStates: Ref.get(states),
      view,
      save,
      saveProfile,
      press,
      release,
      keyInput: input.input,
      gestureFailure: input.failure,
      cancel,
      organize,
      refreshFeedback: Semaphore.withPermits(
        lock,
        1,
      )(
        Effect.gen(function* () {
          const overlayRevision = (yield* overlays?.snapshot ?? Effect.succeed({ revision: 0 }))
            .revision;
          const changed = paintedOverlayRevision !== overlayRevision;
          for (const [key, slot] of (yield* view).keys)
            if (changed || slot.entry?.binding.action === 'plugin')
              yield* paint(key, slot.entry, slot.state);
          paintedOverlayRevision = overlayRevision;
        }),
      ),
      navigate: (command: Navigate) => Semaphore.withPermits(lock, 1)(navigateUnlocked(command)),
    };
  });

/** Standalone convenience; Studio supplies the shared state Layer to makeWithState. */
export const make = (...args: Parameters<typeof makeWithState>) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const services = yield* Layer.build(
      PersistentState.layer.pipe(Layer.provideMerge(FileStorage.layer(path.dirname(args[1])))),
    );
    return yield* makeWithState(...args).pipe(Effect.provideContext(services));
  });
