import { Context, Effect, Layer, Schedule, Schema, Semaphore, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { IntegrationError } from './json-socket.ts';
const Windows = Schema.Array(
  Schema.Struct({
    id: Schema.Int,
    app_id: Schema.NullOr(Schema.String),
    is_focused: Schema.Boolean,
  }),
);
type Window = (typeof Windows.Type)[number];
/** Narrow replaceable desktop boundary; no global keybindings or permission changes. */
export class DesktopKeys extends Context.Service<
  DesktopKeys,
  {
    readonly ready: Effect.Effect<void, IntegrationError>;
    readonly windows: Effect.Effect<ReadonlyArray<Window>, IntegrationError>;
    readonly focus: (id: number) => Effect.Effect<void, IntegrationError>;
    readonly chord: (key: 'm' | 'd') => Effect.Effect<void, IntegrationError>;
  }
>()('@nixfiles/streamdeck/DesktopKeys') {
  static readonly layer = Layer.effect(
    DesktopKeys,
    Effect.gen(function* () {
      const processes = yield* ChildProcessSpawner.ChildProcessSpawner;
      const run = (command: string, args: ReadonlyArray<string>) =>
        Effect.scoped(
          Effect.gen(function* () {
            const process = yield* processes.spawn(
              ChildProcess.make(command, args, { stdin: 'ignore' }),
            );
            const [out, err, code] = yield* Effect.all(
              [
                Stream.mkString(Stream.decodeText(process.stdout)),
                Stream.mkString(Stream.decodeText(process.stderr)),
                process.exitCode,
              ],
              { concurrency: 'unbounded' },
            );
            if (code !== 0)
              return yield* Effect.fail(
                new IntegrationError({
                  message: `${command} : ${err.trim().slice(-1000) || 'commande refusée'}`,
                }),
              );
            return out;
          }),
        ).pipe(
          Effect.timeout('2 seconds'),
          Effect.mapError((error) =>
            error instanceof IntegrationError
              ? error
              : new IntegrationError({
                  message: `${command} indisponible. Ce mode nécessite niri et wtype dans la session Wayland.`,
                }),
          ),
        );
      const windows = run('niri', ['msg', '--json', 'windows']).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Windows))),
        Effect.mapError((error) =>
          error instanceof IntegrationError
            ? error
            : new IntegrationError({ message: 'Liste des fenêtres niri invalide.' }),
        ),
      );
      return {
        ready: run('wtype', ['-s', '1']).pipe(Effect.andThen(windows), Effect.asVoid),
        windows,
        focus: (id: number) =>
          run('niri', ['msg', 'action', 'focus-window', '--id', String(id)]).pipe(Effect.asVoid),
        // wtype uses keysyms, so these chords do not depend on physical AZERTY/QWERTY keycodes.
        chord: (key: 'm' | 'd') =>
          run('wtype', [
            '-M',
            'ctrl',
            '-M',
            'shift',
            '-P',
            key,
            '-p',
            key,
            '-m',
            'shift',
            '-m',
            'ctrl',
          ]).pipe(Effect.asVoid),
      };
    }),
  );
}
export const makeDiscordKeys = Effect.gen(function* () {
  const desktop = yield* DesktopKeys;
  const lock = yield* Semaphore.make(1);
  yield* desktop.ready;
  const current = Effect.map(desktop.windows, (windows) => ({
    backend: 'keyboard',
    windowOpen: windows.some((window) => window.app_id?.toLowerCase() === 'discord'),
    mute: null,
    deaf: null,
  }));
  const toggle = (field: 'mute' | 'deaf') =>
    Semaphore.withPermits(
      lock,
      1,
    )(
      Effect.scoped(
        Effect.gen(function* () {
          const windows = yield* desktop.windows;
          const discord = windows.find((window) => window.app_id?.toLowerCase() === 'discord');
          if (!discord)
            return yield* Effect.fail(
              new IntegrationError({ message: 'Ouvre Discord pour utiliser ce raccourci.' }),
            );
          const previous = windows.find((window) => window.is_focused);
          yield* Effect.addFinalizer(() =>
            Effect.gen(function* () {
              if (!previous || previous.id === discord.id) return;
              const now = yield* desktop.windows;
              // Do not steal focus if the user moved elsewhere during the operation.
              if (
                now.some((window) => window.id === discord.id && window.is_focused) &&
                now.some((window) => window.id === previous.id)
              )
                yield* desktop.focus(previous.id);
            }).pipe(
              Effect.catch((error) => Effect.logWarning('Discord focus restore', error.message)),
            ),
          );
          if (!discord.is_focused) yield* desktop.focus(discord.id);
          yield* Effect.repeat(desktop.windows, {
            until: (candidateWindows) =>
              candidateWindows.some((window) => window.id === discord.id && window.is_focused),
            schedule: Schedule.spaced(10),
          }).pipe(
            Effect.timeout('500 millis'),
            Effect.mapError(
              () =>
                new IntegrationError({
                  message: 'Discord n’a pas reçu le focus ; aucun raccourci envoyé.',
                }),
            ),
          );
          yield* desktop.chord(field === 'mute' ? 'm' : 'd');
          return {
            backend: 'keyboard',
            shortcut: field === 'mute' ? 'Ctrl+Shift+M' : 'Ctrl+Shift+D',
            sent: true,
            mute: null,
            deaf: null,
          };
        }),
      ),
    );
  return { current, toggle, failure: Effect.never };
});
