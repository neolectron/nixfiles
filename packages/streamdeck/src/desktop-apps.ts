import { Config, Effect, FileSystem, Path } from 'effect';
import type { ApplicationEntry } from './studio-contract.ts';

/** Follow XDG precedence, retaining desktop IDs rather than immutable store paths. */
export const discover = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem; const path = yield* Path.Path;
  const home = yield* Config.String('HOME');
  const dataHome = yield* Config.String('XDG_DATA_HOME').pipe(Config.withDefault(path.join(home, '.local/share')));
  const dataDirs = yield* Config.String('XDG_DATA_DIRS').pipe(Config.withDefault('/usr/local/share:/usr/share'));
  const seen = new Set<string>(); const entries: ApplicationEntry[] = [];
  for (const root of [dataHome, ...dataDirs.split(':')]) {
    const directory = path.join(root, 'applications');
    const files = yield* fs.readDirectory(directory).pipe(Effect.catch(() => Effect.succeed([] as string[])));
    for (const id of files.filter((file) => file.endsWith('.desktop')).sort()) {
      if (seen.has(id)) continue; seen.add(id);
      const file = path.join(directory, id);
      const text = yield* fs.readFileString(file).pipe(Effect.catch(() => Effect.succeed('')));
      const section = text.split('[Desktop Entry]')[1]?.split(/\n\[/)[0] ?? '';
      const properties = Object.fromEntries(section.split('\n').flatMap((line) => {
        const at = line.indexOf('='); return at > 0 ? [[line.slice(0, at).trim(), line.slice(at + 1).trim()]] : [];
      }));
      if (properties.Type !== 'Application' || properties.Hidden === 'true' || properties.NoDisplay === 'true' || !properties.Exec) continue;
      const name = properties['Name[fr]'] ?? properties.Name;
      if (name) entries.push({ id, name, file });
    }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
});
