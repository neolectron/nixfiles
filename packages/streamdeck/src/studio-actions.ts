import { createElement } from 'react';
import { Crypto, Data, Effect, Fiber, FileSystem, Path, Ref, Schema, Semaphore, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { ButtonBinding, Profile, actionParameters, type ActionDefinition, type ApplicationEntry, type BindingStatus } from './studio-contract.ts';
import type { Device } from './stream-deck.ts';
import * as Takumi from './takumi.ts';
import { KeyCard } from './ui/key-card.ts';

export class StudioError extends Data.TaggedError('StudioError')<{ readonly message: string; readonly status: number }> {}
const invalid = (message: string, status = 400) => new StudioError({ message, status });
export const catalogue: ReadonlyArray<ActionDefinition> = [
  { id: 'launch-app', name: 'Lancer une application', description: 'Ouvre une application installée sur ce bureau.', defaults: { application: '' }, schema: Schema.toJsonSchemaDocument(actionParameters['launch-app']),
    fields: [{ key: 'application', label: 'Application', kind: 'app', hint: '' }] },
  { id: 'run-command', name: 'Exécuter une commande', description: 'Lance un exécutable ou un script avec ses arguments.', defaults: { executable: '', arguments: [], directory: '' }, schema: Schema.toJsonSchemaDocument(actionParameters['run-command']),
    fields: [{ key: 'executable', label: 'Exécutable ou script', kind: 'text', hint: 'Un nom disponible dans PATH ou un chemin absolu.' },
      { key: 'arguments', label: 'Arguments', kind: 'arguments', hint: 'Un argument par ligne, transmis tel quel.' },
      { key: 'directory', label: 'Dossier de travail', kind: 'text', hint: 'Facultatif. Par défaut, le dossier du moteur.' }] },
  { id: 'counter', name: 'Compteur', description: 'Incrémente une valeur sur la touche pour tester un comportement.', defaults: { start: 0 }, schema: Schema.toJsonSchemaDocument(actionParameters.counter),
    fields: [{ key: 'start', label: 'Valeur de départ', kind: 'number', hint: '' }] },
];
export interface KeyState { readonly count: number; readonly status: BindingStatus; readonly detail: string }
const emptyState: KeyState = { count: 0, status: 'idle', detail: '' };

/** Configurable actions and scripts share these handlers with physical key presses. */
export const make = (deck: Device, profileFile: string, applications: ReadonlyArray<ApplicationEntry>) => Effect.gen(function*() {
  const scope = yield* Effect.scope;
  const fs = yield* FileSystem.FileSystem; const path = yield* Path.Path;
  const processes = yield* ChildProcessSpawner.ChildProcessSpawner;
  const crypto = yield* Crypto.Crypto;
  const renderer = yield* Takumi.make;
  const lock = yield* Semaphore.make(1);
  const loaded = (yield* fs.exists(profileFile))
    ? yield* fs.readFileString(profileFile).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Profile))))
    : { version: 1 as const, buttons: {} };
  const validateKey = (key: number) => deck.buttons.find((button) => button.index === key && button.pixelSize)
    ? Effect.void : Effect.fail(invalid('Cette touche n’existe pas sur le deck.'));
  for (const key of Object.keys(loaded.buttons)) {
    if (String(Number(key)) !== key) return yield* Effect.fail(invalid('Indice de touche invalide dans le profil.'));
    yield* validateKey(Number(key));
  }
  const profile = yield* Ref.make<Profile>(loaded);
  const states = yield* Ref.make<ReadonlyMap<number, KeyState>>(new Map());
  const jobs = new Map<number, Fiber.Fiber<void, never>>();
  const stateFor = (key: number) => Effect.map(Ref.get(states), (all) => all.get(key) ?? emptyState);
  const paint = (key: number, binding: ButtonBinding | undefined, state: KeyState) => Effect.gen(function*() {
    if (!binding) return yield* deck.key(key).clear;
    const size = deck.buttons.find((button) => button.index === key)!.pixelSize!;
    yield* deck.key(key).setImage(yield* renderer.rgb(createElement(KeyCard, { ...size, label: binding.label, action: binding.action, count: state.count, status: state.status }), size));
  });
  const setState = (key: number, state: KeyState) => Ref.update(states, (before) => new Map([...before, [key, state]]));
  for (const [key, binding] of Object.entries(loaded.buttons)) {
    const state = { ...emptyState, count: binding.action === 'counter' ? binding.parameters.start : 0 };
    yield* setState(Number(key), state); yield* paint(Number(key), binding, state);
  }
  const save = (key: number, input: unknown, expected?: ButtonBinding | null) => Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
    yield* validateKey(key);
    if ((yield* stateFor(key)).status === 'running') return yield* Effect.fail(invalid('Une commande est en cours sur cette touche.', 409));
    const binding = input === null ? undefined : yield* Schema.decodeUnknownEffect(ButtonBinding)(input);
    if (binding?.action === 'launch-app' && !applications.some((app) => app.id === binding.parameters.application)) return yield* Effect.fail(invalid('Application introuvable. Choisis une application dans la liste.'));
    const previous = yield* Ref.get(profile); const buttons = { ...previous.buttons };
    if (expected !== undefined && JSON.stringify(previous.buttons[String(key)] ?? null) !== JSON.stringify(expected)) return yield* Effect.fail(invalid('Cette affectation a changé dans un autre éditeur. Recharge la touche avant d’enregistrer.', 409));
    if (binding) buttons[String(key)] = binding; else delete buttons[String(key)];
    const next = { version: 1 as const, buttons };
    yield* fs.makeDirectory(path.dirname(profileFile), { recursive: true });
    const temporary = `${profileFile}.${yield* crypto.randomUUIDv4()}.tmp`;
    yield* Effect.gen(function*() {
      yield* fs.writeFileString(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      yield* fs.rename(temporary, profileFile);
      yield* Ref.set(profile, next);
      const state = { ...emptyState, count: binding?.action === 'counter' ? binding.parameters.start : 0 };
      yield* setState(key, state); yield* paint(key, binding, state);
    }).pipe(Effect.uninterruptible, Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.ignore)));
  }));
  const press = (key: number) => Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
    yield* validateKey(key);
    const binding = (yield* Ref.get(profile)).buttons[String(key)]; if (!binding) return;
    const state = yield* stateFor(key);
    if (state.status === 'running') return yield* Effect.fail(invalid('Cette commande est déjà en cours.', 409));
    if (binding.action === 'counter') {
      const next = { ...state, count: state.count + 1, status: 'success' as const, detail: '' };
      yield* setState(key, next); yield* paint(key, binding, next); return;
    }
    yield* setState(key, { ...state, status: 'running', detail: '' });
    yield* paint(key, binding, { ...state, status: 'running', detail: '' });
    const command = binding.action === 'launch-app'
      ? applications.find((app) => app.id === binding.parameters.application)
        ? ChildProcess.make('gio', ['launch', applications.find((app) => app.id === binding.parameters.application)!.file], { stdin: 'ignore' }) : undefined
      : ChildProcess.make(binding.parameters.executable, binding.parameters.arguments, { stdin: 'ignore', ...(binding.parameters.directory ? { cwd: binding.parameters.directory } : {}) });
    const job = Effect.scoped(Effect.gen(function*() {
      if (!command) return yield* Effect.fail(invalid('Application introuvable.'));
      const handle = yield* processes.spawn(command);
      const output = (stream: typeof handle.stdout) => Stream.runForEach(Stream.decodeText(stream), (text) => Ref.update(states, (all) => {
        const current = all.get(key) ?? state;
        return new Map([...all, [key, { ...current, detail: (current.detail + text).slice(-4096) }]]);
      }));
      const [, , code] = yield* Effect.all([output(handle.stdout), output(handle.stderr), handle.exitCode], { concurrency: 'unbounded' });
      if (code !== 0) return yield* Effect.fail(invalid(`La commande s’est terminée avec le code ${code}.`));
    })).pipe(Effect.matchEffect({
      onSuccess: () => Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
        const next = { ...(yield* stateFor(key)), status: 'success' as const }; yield* setState(key, next); yield* paint(key, binding, next);
      })),
      onFailure: (error) => Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
        const current = yield* stateFor(key); const next = { ...current, status: 'error' as const, detail: `${current.detail}\n${error.message}`.trim().slice(-4096) };
        yield* setState(key, next); yield* paint(key, binding, next);
      })),
    }), Effect.catch((error) => Effect.logError('Action feedback failed', error)));
    jobs.set(key, yield* Effect.forkIn(job, scope));
  }));
  const cancel = (key: number) => Effect.gen(function*() {
    yield* validateKey(key);
    const fiber = yield* Semaphore.withPermits(lock, 1)(Effect.sync(() => jobs.get(key)));
    if (fiber) yield* Fiber.interrupt(fiber);
    yield* Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
      if (jobs.get(key) !== fiber) return;
      if ((yield* stateFor(key)).status !== 'running') return;
      const next = { ...(yield* stateFor(key)), status: 'idle' as const, detail: 'Commande arrêtée.' };
      yield* setState(key, next); yield* paint(key, (yield* Ref.get(profile)).buttons[String(key)], next);
    }));
  });
  return { profile: Ref.get(profile), states: Ref.get(states), save, press, cancel };
});
