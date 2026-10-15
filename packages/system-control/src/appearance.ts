import { Config, Context, Effect, Layer, Schema, Semaphore, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { IntegrationError } from './errors.ts';
import * as State from './state.ts';

export const Mode = Schema.Literals(['dark', 'light']);
export type Mode = typeof Mode.Type;
export interface Appearance {
  readonly mode: Mode;
  readonly preference: 'default' | 'prefer-dark' | 'prefer-light';
}
export const decodePreference = (raw: string): Appearance => {
  const preference = raw.trim().replace(/^'|'$/g, '');
  if (preference !== 'default' && preference !== 'prefer-dark' && preference !== 'prefer-light')
    throw new IntegrationError({ message: 'Préférence de thème système invalide.' });
  return { mode: preference === 'prefer-dark' ? 'dark' : 'light', preference };
};

/** Replace this boundary for another desktop; the service has no USB or UI dependency. */
export class AppearanceBackend extends Context.Service<
  AppearanceBackend,
  {
    readonly read: Effect.Effect<Appearance, IntegrationError>;
    readonly set: (mode: Mode) => Effect.Effect<void, IntegrationError>;
  }
>()('@nixfiles/system-control/AppearanceBackend') {
  static readonly layer = Layer.effect(
    AppearanceBackend,
    Effect.gen(function* () {
      const processes = yield* ChildProcessSpawner.ChildProcessSpawner;
      const backend = yield* Config.Literals(
        ['noctalia', 'gsettings'],
        'STREAMDECK_APPEARANCE_BACKEND',
      ).pipe(Config.withDefault('noctalia'));
      const run = (executable: string, args: ReadonlyArray<string>) =>
        Effect.scoped(
          Effect.gen(function* () {
            const process = yield* processes.spawn(
              ChildProcess.make(executable, args, {
                stdin: 'ignore',
                forceKillAfter: '500 millis',
              }),
            );
            const [code, text] = yield* Effect.all(
              [
                process.exitCode,
                Stream.mkString(Stream.decodeText(process.stdout)),
                Stream.runDrain(process.stderr),
              ],
              { concurrency: 'unbounded' },
            );
            if (code !== 0)
              return yield* new IntegrationError({
                message: `${executable} n’a pas pu lire ou modifier le thème système.`,
              });
            return text;
          }),
        ).pipe(
          Effect.timeout('3 seconds'),
          Effect.mapError((error) =>
            error instanceof IntegrationError
              ? error
              : new IntegrationError({
                  message: `${executable} est indisponible dans cette session.`,
                }),
          ),
        );
      return {
        read: run('gsettings', ['get', 'org.gnome.desktop.interface', 'color-scheme']).pipe(
          Effect.flatMap((raw) =>
            Effect.try({
              try: () => decodePreference(raw),
              catch: () =>
                new IntegrationError({ message: 'Préférence de thème système invalide.' }),
            }),
          ),
        ),
        set: (mode: Mode) =>
          Effect.gen(function* () {
            // The desktop owns its palette and app templates; no settings-file rewriting here.
            if (backend === 'noctalia')
              yield* run('noctalia-shell', [
                'ipc',
                'call',
                'darkMode',
                mode === 'dark' ? 'setDark' : 'setLight',
              ]);
            // Publish the standard preference even when Noctalia's optional sync is disabled.
            yield* run('gsettings', [
              'set',
              'org.gnome.desktop.interface',
              'color-scheme',
              `prefer-${mode}`,
            ]);
          }),
      };
    }),
  );
}

export const make = Effect.gen(function* () {
  const backend = yield* AppearanceBackend;
  const lock = yield* Semaphore.make(1);
  const store = yield* State.polling(
    backend.read,
    '1 second',
    new IntegrationError({ message: 'Thème système indisponible.' }),
    'appearance',
  );
  const change = (requested: Mode | 'toggle') =>
    store.guard(
      Semaphore.withPermits(
        lock,
        1,
      )(
        Effect.gen(function* () {
          // Read inside the command lock: rapid presses and external desktop changes remain correct.
          const current = yield* backend.read;
          const mode =
            requested === 'toggle' ? (current.mode === 'dark' ? 'light' : 'dark') : requested;
          yield* backend.set(mode);
          const updated = yield* store.refresh;
          if (updated.mode !== mode)
            return yield* new IntegrationError({
              message: 'La préférence système n’a pas suivi le changement de thème.',
            });
          return updated;
        }),
      ),
    );
  return {
    state: store.state,
    snapshot: store.snapshot,
    observe: store.observe,
    refresh: store.refresh,
    set: (mode: Mode) =>
      Schema.decodeUnknownEffect(Mode)(mode).pipe(
        Effect.mapError(() => new IntegrationError({ message: 'Choisis dark ou light.' })),
        Effect.flatMap(change),
      ),
    toggle: change('toggle'),
  };
});
export type Controller = Effect.Success<typeof make>;
export class SystemAppearance extends Context.Service<SystemAppearance, Controller>()(
  '@nixfiles/system-control/SystemAppearance',
) {
  static readonly serviceLayer = Layer.effect(SystemAppearance, make);
  static readonly layer = SystemAppearance.serviceLayer.pipe(
    Layer.provide(AppearanceBackend.layer),
  );
}
