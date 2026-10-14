import { Context, Effect, Layer, Ref, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { StudioError } from '../studio-errors.ts';
import { actionParameters, type ApplicationEntry } from '../studio-contract.ts';
import * as Plugin from '../plugin.ts';

export const make = (applications: ReadonlyArray<ApplicationEntry>) => Effect.gen(function*() {
  const processes = yield* ChildProcessSpawner.ChildProcessSpawner;
  const run = (kind: 'run-command' | 'launch-app', input: unknown, output: (text: string) => Effect.Effect<void> = () => Effect.void) => Effect.scoped(Effect.gen(function*() {
    const binding = kind === 'run-command' ? yield* Schema.decodeUnknownEffect(actionParameters['run-command'])(input) : yield* Schema.decodeUnknownEffect(actionParameters['launch-app'])(input);
    const application = 'application' in binding ? applications.find((app) => app.id === binding.application) : undefined;
    if ('application' in binding && !application) return yield* Effect.fail(new StudioError({ message: 'Application introuvable.', status: 400 }));
    const command = 'executable' in binding ? ChildProcess.make(binding.executable, binding.arguments, { stdin: 'ignore', ...(binding.directory ? { cwd: binding.directory } : {}) }) : ChildProcess.make('gio', ['launch', application!.file], { stdin: 'ignore' });
    const handle = yield* processes.spawn(command); const text = yield* Ref.make('');
    const drain = (source: typeof handle.stdout) => Stream.runForEach(Stream.decodeText(source), (chunk) => Ref.update(text, (before) => (before + chunk).slice(-4096)).pipe(Effect.andThen(output(chunk))));
    const [, , code] = yield* Effect.all([drain(handle.stdout), drain(handle.stderr), handle.exitCode], { concurrency: 'unbounded' });
    if (code !== 0) return yield* Effect.fail(new StudioError({ message: `La commande s’est terminée avec le code ${code}.`, status: 500 }));
    return yield* Ref.get(text);
  }));
  return { run };
});
export type Controller = Effect.Success<ReturnType<typeof make>>;
export class Commands extends Context.Service<Commands, Controller>()('@nixfiles/streamdeck/Commands') {
  static readonly layer = (applications: ReadonlyArray<ApplicationEntry>) => Layer.effect(Commands, make(applications));
}
export const plugin = (applications: ReadonlyArray<ApplicationEntry>) => Plugin.fromLayer({
  id: 'commands', name: 'Applications et scripts', description: 'Lancements d’applications et commandes CLI, avec sortie en direct et arrêt des processus.', controls: {},
  service: Commands, layer: Commands.layer(applications), actions: [
    Plugin.action({ id: 'run-command', name: 'Exécuter une commande', description: 'Lance un exécutable avec des arguments littéraux.', input: actionParameters['run-command'], defaults: { executable: 'printf', arguments: ['%s\\n', 'Hello depuis Effect'], directory: '' }, run: (api: Controller, input, context) => api.run('run-command', input, context.output) }),
    Plugin.action({ id: 'launch-app', name: 'Lancer une application', description: 'Identifiant desktop de l’application installée.', input: actionParameters['launch-app'], defaults: { application: 'unconfigured.desktop' }, run: (api: Controller, input, context) => api.run('launch-app', input, context.output) }),
  ],
});
