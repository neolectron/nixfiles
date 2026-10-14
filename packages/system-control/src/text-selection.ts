import {
  Context,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Option,
  Schedule,
  Schema,
  Semaphore,
  Stream,
} from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { IntegrationError } from './errors.ts';
import { TextTransform } from './text-transform.ts';

export interface Selection {
  readonly window: number;
  readonly text: string;
}
export class SelectionBackend extends Context.Service<
  SelectionBackend,
  {
    readonly capture: Effect.Effect<Selection, IntegrationError>;
    readonly replace: (selection: Selection, text: string) => Effect.Effect<void, IntegrationError>;
  }
>()('@nixfiles/system-control/SelectionBackend') {
  static readonly layer = Layer.effect(
    SelectionBackend,
    Effect.gen(function* () {
      const processes = yield* ChildProcessSpawner.ChildProcessSpawner;
      const owner = yield* Effect.scope;
      let writer: Fiber.Fiber<void, never> | undefined;
      const run = (command: string, args: ReadonlyArray<string>) =>
        Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* processes.spawn(
              ChildProcess.make(command, args, { stdin: 'ignore', forceKillAfter: '500 millis' }),
            );
            const [code, out] = yield* Effect.all(
              [
                handle.exitCode,
                Stream.mkString(Stream.decodeText(handle.stdout)),
                Stream.runDrain(handle.stderr),
              ],
              { concurrency: 'unbounded' },
            );
            if (code !== 0)
              return yield* new IntegrationError({
                message: `${command} indisponible ou aucune sélection de texte.`,
              });
            return out;
          }),
        ).pipe(
          Effect.timeout('2 seconds'),
          Effect.mapError((error) =>
            error instanceof IntegrationError
              ? error
              : new IntegrationError({ message: `${command} n’a pas répondu.` }),
          ),
        );
      const focused = run('niri', ['msg', '--json', 'focused-window']).pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(
            Schema.fromJsonString(Schema.NullOr(Schema.Struct({ id: Schema.Int }))),
          ),
        ),
        Effect.mapError(
          () => new IntegrationError({ message: 'La fenêtre active est indisponible.' }),
        ),
      );
      const primary = run('wl-paste', ['--primary', '--no-newline', '--type', 'text']);
      return wayland({
        focused: Effect.map(focused, (window) => window?.id ?? null),
        primary,
        paste: run('wtype', ['-M', 'ctrl', '-k', 'v', '-m', 'ctrl']).pipe(Effect.asVoid),
        publish: (text: string) =>
          Effect.gen(function* () {
            if (writer) yield* Fiber.interrupt(writer);
            const started = yield* Deferred.make<void, IntegrationError>();
            writer = yield* Effect.forkIn(
              Effect.scoped(
                Effect.gen(function* () {
                  const process = yield* processes.spawn(
                    ChildProcess.make(
                      'wl-copy',
                      ['--foreground', '--type', 'text/plain;charset=utf-8'],
                      {
                        stdin: Stream.succeed(new TextEncoder().encode(text)),
                        stdout: 'ignore',
                        stderr: 'ignore',
                        forceKillAfter: '500 millis',
                      },
                    ),
                  );
                  yield* Deferred.succeed(started, undefined);
                  yield* process.exitCode;
                }),
              ).pipe(
                Effect.catchCause(() =>
                  Deferred.fail(
                    started,
                    new IntegrationError({
                      message: 'Publication du texte dans le presse-papiers impossible.',
                    }),
                  ),
                ),
                Effect.asVoid,
              ),
              owner,
            );
            yield* Deferred.await(started);
            yield* Effect.repeat(run('wl-paste', ['--no-newline', '--type', 'text']), {
              until: (value) => value === text,
              schedule: Schedule.spaced(20),
            }).pipe(
              Effect.timeout('2 seconds'),
              Effect.mapError(
                () =>
                  new IntegrationError({
                    message: 'Le presse-papiers n’a pas reçu le texte transformé.',
                  }),
              ),
            );
          }),
      });
    }),
  );
}

/** Replaceable Wayland operations keep focus/selection checks deterministic in tests. */
export interface WaylandTransport {
  readonly focused: Effect.Effect<number | null, IntegrationError>;
  readonly primary: Effect.Effect<string, IntegrationError>;
  readonly publish: (text: string) => Effect.Effect<void, IntegrationError>;
  readonly paste: Effect.Effect<void, IntegrationError>;
}
export const wayland = (transport: WaylandTransport) => {
  const capture = Effect.gen(function* () {
    const window = yield* transport.focused;
    if (window === null) return yield* new IntegrationError({ message: 'Aucune fenêtre active.' });
    const text = yield* transport.primary;
    if (!text.trim())
      return yield* new IntegrationError({
        message: 'Sélectionne d’abord du texte dans un champ éditable.',
      });
    if ((yield* transport.focused) !== window)
      return yield* new IntegrationError({ message: 'La fenêtre active a changé.' });
    return { window, text };
  });
  const check = (selection: Selection) =>
    Effect.gen(function* () {
      const current = yield* capture;
      if (current.window !== selection.window || current.text !== selection.text)
        return yield* new IntegrationError({
          message: 'La fenêtre ou la sélection a changé ; aucun texte remplacé.',
        });
    });
  return {
    capture,
    replace: (selection: Selection, text: string) =>
      Effect.gen(function* () {
        yield* check(selection);
        yield* transport.publish(text);
        yield* check(selection);
        // Paste, never type Return: multiline transformations must not submit chat messages.
        yield* transport.paste;
      }),
  };
};

export const make = Effect.gen(function* () {
  const backend = yield* SelectionBackend;
  const model = yield* TextTransform;
  const lock = yield* Semaphore.make(1);
  const owner = yield* Effect.scope;
  let closed = false;
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true;
    }),
  );
  return {
    transform: (
      prompt: string,
      output: (message: string) => Effect.Effect<void> = () => Effect.void,
    ) =>
      Effect.suspend(() => {
        if (!prompt.trim())
          return Effect.fail(new IntegrationError({ message: 'Un prompt est requis.' }));
        if (closed)
          return Effect.fail(
            new IntegrationError({ message: 'Le service de sélection est fermé.' }),
          );
        return Effect.acquireUseRelease(
          Effect.forkIn(
            Semaphore.withPermitsIfAvailable(
              lock,
              1,
            )(
              Effect.gen(function* () {
                const selection = yield* backend.capture;
                yield* output('Transformation en cours…');
                const text = yield* model.transform({ text: selection.text, prompt });
                if (!text.trim())
                  return yield* new IntegrationError({
                    message: 'La transformation est vide ; aucun texte remplacé.',
                  });
                yield* backend.replace(selection, text);
                return 'Texte remplacé.';
              }),
            ),
            owner,
          ),
          (fiber) =>
            Fiber.join(fiber).pipe(
              Effect.flatMap((value) =>
                Option.isSome(value)
                  ? Effect.succeed(value.value)
                  : Effect.fail(
                      new IntegrationError({ message: 'Une transformation est déjà en cours.' }),
                    ),
              ),
            ),
          Fiber.interrupt,
        );
      }),
  };
});
export type Controller = Effect.Success<typeof make>;
export class TextSelection extends Context.Service<TextSelection, Controller>()(
  '@nixfiles/system-control/TextSelection',
) {
  static readonly serviceLayer = Layer.effect(TextSelection, make);
  static readonly layer = TextSelection.serviceLayer.pipe(
    Layer.provide(Layer.merge(SelectionBackend.layer, TextTransform.layer)),
  );
}
