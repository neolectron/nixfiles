import {
  Config,
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Result,
  Schema,
  Semaphore,
  Stream,
} from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { IntegrationError } from './errors.ts';
import { disabledMcp } from './codex-config.ts';
import * as State from './state.ts';

export const Request = Schema.Struct({
  prompt: Schema.NonEmptyString.check(Schema.isMaxLength(32000)).annotate({
    title: 'Prompt',
    contentMediaType: 'text/plain',
  }),
  directory: Schema.String.check(Schema.isMaxLength(4096)).annotate({
    title: 'Dossier',
    description: 'Chemin absolu du projet. Vide : exécution dans un dossier temporaire.',
  }),
  access: Schema.Literals(['read-only', 'workspace-write']).annotate({
    title: 'Accès aux fichiers',
    description:
      'read-only : consulter. workspace-write : autoriser les modifications dans le dossier choisi.',
  }),
});
export type Request = typeof Request.Type;
export class CodexBackend extends Context.Service<
  CodexBackend,
  {
    readonly run: (request: Request) => Effect.Effect<string, IntegrationError>;
  }
>()('@nixfiles/system-control/CodexBackend') {
  static readonly layer = Layer.effect(
    CodexBackend,
    Effect.gen(function* () {
      return yield* codex(
        yield* Config.String('STREAMDECK_CODEX_COMMAND').pipe(Config.withDefault('codex')),
        yield* Config.String('STREAMDECK_CODEX_MODEL').pipe(Config.withDefault('gpt-6-luna')),
      );
    }),
  );
}

/** A managed background job: stdin carries the prompt; no detached Codex or global config edits. */
export const codex = (executable = 'codex', model = 'gpt-6-luna') =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const processes = yield* ChildProcessSpawner.ChildProcessSpawner;
    return {
      run: (request: Request) =>
        Effect.scoped(
          Effect.gen(function* () {
            const input = yield* Schema.decodeUnknownEffect(Request)(request);
            if (!input.prompt.trim())
              return yield* new IntegrationError({ message: 'Le prompt est vide.' });
            const temporary = yield* fs.makeTempDirectoryScoped({ prefix: 'codex-prompt-' });
            const directory = input.directory || temporary;
            if (!path.isAbsolute(directory) || (yield* fs.stat(directory)).type !== 'Directory')
              return yield* new IntegrationError({
                message: 'Choisis un dossier existant avec son chemin absolu.',
              });
            if (!input.directory && input.access !== 'read-only')
              return yield* new IntegrationError({
                message: 'Choisis un dossier pour autoriser les modifications.',
              });
            const output = `${temporary}/response.txt`;
            const mcp = yield* disabledMcp(executable, temporary).pipe(
              Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, processes),
            );
            const process = yield* processes.spawn(
              ChildProcess.make(
                executable,
                [
                  'exec',
                  '--model',
                  model,
                  '--ephemeral',
                  '--ignore-user-config',
                  '--skip-git-repo-check',
                  '--sandbox',
                  input.access,
                  '--color',
                  'never',
                  '--disable',
                  'multi_agent',
                  '--disable',
                  'plugins',
                  '--disable',
                  'apps',
                  '--disable',
                  'memories',
                  '-c',
                  'skills.include_instructions=false',
                  '-c',
                  'skills.bundled.enabled=false',
                  '-c',
                  `mcp_servers=${mcp}`,
                  '-c',
                  'model_reasoning_effort="low"',
                  '-c',
                  'web_search="disabled"',
                  '--output-last-message',
                  output,
                  '-',
                ],
                {
                  cwd: directory,
                  stdin: Stream.succeed(new TextEncoder().encode(input.prompt)),
                  forceKillAfter: '1 second',
                },
              ),
            );
            const [code] = yield* Effect.all(
              [process.exitCode, Stream.runDrain(process.stdout), Stream.runDrain(process.stderr)],
              { concurrency: 'unbounded' },
            );
            if (code !== 0)
              return yield* new IntegrationError({
                message: `Le prompt Codex a échoué (code ${code}). Vérifie codex login status.`,
              });
            const info = yield* fs.stat(output);
            if (Number(info.size) > 256000)
              return yield* new IntegrationError({
                message: 'La réponse Codex est trop volumineuse.',
              });
            const response = yield* fs.readFileString(output);
            if (!response.trim())
              return yield* new IntegrationError({ message: 'Codex a renvoyé une réponse vide.' });
            return response;
          }),
        ).pipe(
          Effect.timeout('10 minutes'),
          Effect.mapError((error) =>
            error instanceof IntegrationError
              ? error
              : new IntegrationError({
                  message: 'Codex indisponible, dossier invalide ou délai dépassé.',
                }),
          ),
        ),
    };
  });

export const make = Effect.gen(function* () {
  const backend = yield* CodexBackend;
  const lock = yield* Semaphore.make(1);
  const state = yield* State.make<boolean, IntegrationError>(
    new IntegrationError({ message: 'Le service Codex est fermé.' }),
  );
  yield* state.publish(Result.succeed(false));
  return {
    busy: state.state,
    run: (request: Request) =>
      state.guard(
        Effect.gen(function* () {
          const input = yield* Schema.decodeUnknownEffect(Request)(request).pipe(
            Effect.mapError(
              () =>
                new IntegrationError({
                  message: 'Le prompt ou les paramètres Codex sont invalides.',
                }),
            ),
          );
          if (!input.prompt.trim())
            return yield* new IntegrationError({ message: 'Le prompt est vide.' });
          const result = yield* Semaphore.withPermitsIfAvailable(
            lock,
            1,
          )(
            state
              .publish(Result.succeed(true))
              .pipe(
                Effect.andThen(backend.run(input)),
                Effect.ensuring(state.publish(Result.succeed(false))),
              ),
          );
          return Option.isSome(result)
            ? result.value
            : yield* new IntegrationError({ message: 'Un prompt Codex est déjà en cours.' });
        }),
      ),
  };
});
export type Controller = Effect.Success<typeof make>;
export class CodexPrompt extends Context.Service<CodexPrompt, Controller>()(
  '@nixfiles/system-control/CodexPrompt',
) {
  static readonly serviceLayer = Layer.effect(CodexPrompt, make);
  static readonly layer = CodexPrompt.serviceLayer.pipe(Layer.provide(CodexBackend.layer));
}
