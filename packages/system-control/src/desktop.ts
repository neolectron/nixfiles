import { Config, Context, Effect, FileSystem, Layer, Path, Result, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { IntegrationError } from './errors.ts';
import * as State from './state.ts';

export interface Application {
  readonly id: string;
  readonly name: string;
  readonly file: string;
  readonly windowClass?: string;
  readonly icon?: string;
}
export interface Target {
  /** Ordered preference, e.g. Spotifast before Spotify. */
  readonly applications: ReadonlyArray<string>;
  readonly windows: ReadonlyArray<string>;
}
export interface Window {
  readonly id: number;
  readonly app_id: string | null;
  readonly is_focused?: boolean;
  readonly title?: string;
}
export interface Status {
  readonly application: Application | null;
  readonly windows: ReadonlyArray<Window>;
  readonly running: boolean;
}

/** XDG precedence and stable desktop IDs; discovery never launches anything. */
export const discover = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* Config.String('HOME');
  const dataHome = yield* Config.String('XDG_DATA_HOME').pipe(
    Config.withDefault(path.join(home, '.local/share')),
  );
  const dataDirs = yield* Config.String('XDG_DATA_DIRS').pipe(
    Config.withDefault('/usr/local/share:/usr/share'),
  );
  const seen = new Set<string>();
  const entries: Application[] = [];
  for (const root of [dataHome, ...dataDirs.split(':')]) {
    const directory = path.join(root, 'applications');
    const files = yield* fs.readDirectory(directory).pipe(Effect.catch(() => Effect.succeed([])));
    for (const id of files.filter((file) => file.endsWith('.desktop')).toSorted()) {
      if (seen.has(id)) continue;
      seen.add(id);
      const file = path.join(directory, id);
      const text = yield* fs.readFileString(file).pipe(Effect.catch(() => Effect.succeed('')));
      const section = text.split('[Desktop Entry]')[1]?.split(/\n\[/)[0] ?? '';
      const properties = Object.fromEntries(
        section.split('\n').flatMap((line) => {
          const at = line.indexOf('=');
          return at > 0 ? [[line.slice(0, at).trim(), line.slice(at + 1).trim()]] : [];
        }),
      );
      if (
        properties.Type !== 'Application' ||
        properties.Hidden === 'true' ||
        properties.NoDisplay === 'true' ||
        !properties.Exec
      )
        continue;
      const name = properties['Name[fr]'] ?? properties.Name;
      if (name)
        entries.push({
          id,
          name,
          file,
          ...(properties.StartupWMClass ? { windowClass: properties.StartupWMClass } : {}),
          ...(properties.Icon ? { icon: properties.Icon } : {}),
        });
    }
  }
  return entries.toSorted((a, b) => a.name.localeCompare(b.name));
});

/** Replace this boundary for a different desktop or for deterministic tests. */
export class DesktopBackend extends Context.Service<
  DesktopBackend,
  {
    readonly applications: Effect.Effect<ReadonlyArray<Application>, IntegrationError>;
    readonly windows: Effect.Effect<ReadonlyArray<Window>, IntegrationError>;
    readonly launch: (application: Application) => Effect.Effect<void, IntegrationError>;
    readonly focus: (window: Window) => Effect.Effect<void, IntegrationError>;
  }
>()('@nixfiles/system-control/DesktopBackend') {
  static readonly layer = Layer.effect(
    DesktopBackend,
    Effect.gen(function* () {
      const processes = yield* ChildProcessSpawner.ChildProcessSpawner;
      const platform = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
      const run = (command: string, args: ReadonlyArray<string>, launch = false) =>
        Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* processes.spawn(
              ChildProcess.make(command, args, {
                stdin: 'ignore',
                ...(launch ? { stdout: 'ignore' as const, stderr: 'ignore' as const } : {}),
              }),
            );
            // A launched GUI belongs to the user, not the service's resource scope.
            if (launch) yield* handle.unref;
            const [out, err, code] = yield* Effect.all(
              [
                Stream.mkString(Stream.decodeText(handle.stdout)),
                Stream.mkString(Stream.decodeText(handle.stderr)),
                handle.exitCode,
              ],
              { concurrency: 'unbounded' },
            );
            if (code !== 0)
              return yield* new IntegrationError({
                message: `${command} : ${err.trim() || `code ${code}`}`,
              });
            return out;
          }),
        ).pipe(
          Effect.timeout('3 seconds'),
          Effect.mapError((error) =>
            error instanceof IntegrationError
              ? error
              : new IntegrationError({ message: `${command} indisponible dans cette session.` }),
          ),
        );
      return {
        applications: discover.pipe(
          Effect.provideContext(platform),
          Effect.mapError(
            () => new IntegrationError({ message: 'Découverte des applications indisponible.' }),
          ),
        ),
        windows: run('niri', ['msg', '--json', 'windows']).pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.fromJsonString(
                Schema.Array(
                  Schema.Struct({
                    id: Schema.Int,
                    app_id: Schema.NullOr(Schema.String),
                    is_focused: Schema.optionalKey(Schema.Boolean),
                    title: Schema.optionalKey(Schema.String),
                  }),
                ),
              ),
            ),
          ),
          Effect.mapError(
            () =>
              new IntegrationError({ message: 'État des fenêtres indisponible (backend niri).' }),
          ),
        ),
        launch: (application: Application) =>
          run('gio', ['launch', application.file], true).pipe(Effect.asVoid),
        focus: (window: Window) =>
          run('niri', ['msg', 'action', 'focus-window', '--id', String(window.id)]).pipe(
            Effect.asVoid,
          ),
      };
    }),
  );
}

export const make = Effect.gen(function* () {
  const backend = yield* DesktopBackend;
  const applications = yield* backend.applications;
  const store = yield* State.polling(
    backend.windows,
    '1 second',
    new IntegrationError({ message: 'État des fenêtres indisponible.' }),
  );
  const status = (target: Target) =>
    Effect.gen(function* () {
      const application =
        target.applications
          .map((id) => applications.find((app) => app.id === id))
          .find((app) => !!app) ?? null;
      const names = new Set(
        [
          ...target.windows,
          ...applications
            .filter((app) => target.applications.includes(app.id))
            .map((app) => app.windowClass ?? app.id.replace(/\.desktop$/, '')),
        ].map((name) => name.toLowerCase()),
      );
      const windows = (yield* store.state).filter(
        (window) => window.app_id && names.has(window.app_id.toLowerCase()),
      );
      return { application, windows, running: windows.length > 0 };
    });
  return {
    applications,
    snapshot: store.snapshot,
    observe: store.observe,
    /** Window-manager focus, independent from application launch/running state. */
    focused: store.state.pipe(
      Effect.map((windows) => windows.find((window) => window.is_focused) ?? null),
    ),
    focusChanges: store.observe.pipe(
      Stream.map((state) =>
        Result.map(state, (windows) => windows.find((window) => window.is_focused) ?? null),
      ),
    ),
    status,
    refresh: store.refresh,
    open: (target: Target) =>
      store.guard(
        Effect.gen(function* () {
          // Re-read at invocation so a cached tile cannot create a duplicate window.
          yield* store.refresh;
          const current = yield* status(target);
          const window = current.windows[0];
          if (window) yield* backend.focus(window);
          else if (current.application) yield* backend.launch(current.application);
          else
            return yield* new IntegrationError({
              message: `Application non installée : ${target.applications.join(', ')}.`,
            });
          return window ? 'Fenêtre activée.' : 'Lancement demandé.';
        }),
      ),
  };
});
export type Controller = Effect.Success<typeof make>;
export class Desktop extends Context.Service<Desktop, Controller>()(
  '@nixfiles/system-control/Desktop',
) {
  static readonly serviceLayer = Layer.effect(Desktop, make);
  static readonly layer = Desktop.serviceLayer.pipe(Layer.provide(DesktopBackend.layer));
}
