import { Crypto, Effect, FileSystem, Path, Schema } from 'effect';
import { mergeDiscordPreferences } from './studio-profile-migrations.ts';

const Settings = Schema.Struct({
  version: Schema.Literal(1),
  enabled: Schema.Record(Schema.String, Schema.Boolean),
});
/** Separate from key-layout persistence; existing profiles and unknown plugin preferences survive. */
export const make = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    let enabled: Readonly<Record<string, boolean>> = (yield* fs.exists(file))
      ? (yield* fs
          .readFileString(file)
          .pipe(
            Effect.flatMap((text) =>
              Schema.decodeUnknownEffect(Schema.fromJsonString(Settings))(text),
            ),
          )).enabled
      : {};
    const write = (next: Readonly<Record<string, boolean>>) =>
      Effect.gen(function* () {
        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        const temporary = `${file}.${yield* crypto.randomUUIDv4()}.tmp`;
        yield* Effect.gen(function* () {
          yield* fs.writeFileString(
            temporary,
            `${JSON.stringify({ version: 1, enabled: next }, null, 2)}\n`,
            { mode: 0o600 },
          );
          yield* fs.rename(temporary, file);
          enabled = next;
        }).pipe(
          Effect.uninterruptible,
          Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.ignore)),
        );
      });
    const migrated = mergeDiscordPreferences(enabled);
    if (migrated !== enabled) yield* write(migrated);
    return {
      initial: enabled,
      save: (id: string, value: boolean) =>
        Effect.suspend(() => write({ ...enabled, [id]: value })),
    };
  });
