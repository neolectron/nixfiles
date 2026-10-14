import { Crypto, Effect, FileSystem, Layer, Path } from 'effect';
import { KeyValueStoreError } from 'effect/persistence/KeyValueStore';
import { StateStorage, type Adapter } from './state-storage.ts';

const operation = <A, E, R>(method: string, key: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.mapError((cause) =>
      cause instanceof KeyValueStoreError
        ? cause
        : new KeyValueStoreError({
            method,
            key,
            message: `State storage ${method} failed.`,
            cause,
          }),
    ),
  );

/** Relative logical keys preserve the existing JSON files. Only set/remove mutate disk. */
export const layer = (directory: string) =>
  Layer.effect(
    StateStorage,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const crypto = yield* Crypto.Crypto;
      const target = (key: string) =>
        !key ||
        key
          .split('/')
          .some(
            (part) =>
              !part || part === '.' || part === '..' || part.includes('\\') || part.includes('\0'),
          )
          ? Effect.fail(
              new KeyValueStoreError({
                method: 'key',
                key,
                message: 'Invalid relative state key.',
              }),
            )
          : Effect.succeed(path.join(directory, ...key.split('/')));
      return {
        get: (key) =>
          operation(
            'get',
            key,
            Effect.gen(function* () {
              const file = yield* target(key);
              return yield* fs
                .readFileString(file)
                .pipe(
                  Effect.catchTag('PlatformError', (error) =>
                    error.reason._tag === 'NotFound' ? Effect.undefined : Effect.fail(error),
                  ),
                );
            }),
          ),
        set: (key, value) =>
          operation(
            'set',
            key,
            Effect.gen(function* () {
              const file = yield* target(key);
              yield* fs.makeDirectory(path.dirname(file), { recursive: true, mode: 0o700 });
              const temporary = `${file}.${yield* crypto.randomUUIDv4()}.tmp`;
              yield* Effect.uninterruptible(
                (typeof value === 'string'
                  ? fs.writeFileString(temporary, value, { mode: 0o600 })
                  : fs.writeFile(temporary, value, { mode: 0o600 })
                ).pipe(
                  Effect.andThen(fs.rename(temporary, file)),
                  Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.ignore)),
                ),
              );
            }),
          ),
        remove: (key) =>
          operation(
            'remove',
            key,
            Effect.flatMap(target(key), (file) => fs.remove(file, { force: true })),
          ),
      } satisfies Adapter;
    }),
  );
