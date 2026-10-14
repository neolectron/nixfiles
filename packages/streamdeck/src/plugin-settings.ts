import { Crypto, Effect, FileSystem, Path, Schema } from 'effect';

const Settings = Schema.Struct({ version: Schema.Literal(1), enabled: Schema.Record(Schema.String, Schema.Boolean) });
/** Separate from key-layout persistence; existing profiles and unknown plugin preferences survive. */
export const make = (file: string) => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem; const path = yield* Path.Path; const crypto = yield* Crypto.Crypto;
  let enabled: Readonly<Record<string, boolean>> = (yield* fs.exists(file)) ? (yield* fs.readFileString(file).pipe(Effect.flatMap((text) => Schema.decodeUnknownEffect(Schema.fromJsonString(Settings))(text)))).enabled : {};
  return { initial: enabled, save: (id: string, value: boolean) => Effect.gen(function*() {
    const next = { ...enabled, [id]: value };
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    const temporary = `${file}.${yield* crypto.randomUUIDv4()}.tmp`;
    yield* Effect.gen(function*() {
      yield* fs.writeFileString(temporary, `${JSON.stringify({ version: 1, enabled: next }, null, 2)}\n`, { mode: 0o600 });
      yield* fs.rename(temporary, file); enabled = next;
    }).pipe(Effect.uninterruptible, Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.ignore)));
  }) };
});
