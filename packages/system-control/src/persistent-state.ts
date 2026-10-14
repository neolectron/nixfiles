import { Context, Effect, Fiber, Layer, Option, Schema, Semaphore } from 'effect';
import { KeyValueStoreError } from 'effect/persistence/KeyValueStore';
import { StateStorage } from './state-storage.ts';

export const make = Effect.gen(function* () {
  const storage = yield* StateStorage;
  const owner = yield* Effect.scope;
  // Shared by every document and service using this instance. Not a distributed transaction.
  const lock = yield* Semaphore.make(1);
  let closed = false;
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true;
    }),
  );
  const guard = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.suspend(
      (): Effect.Effect<A, E | KeyValueStoreError, R> =>
        closed
          ? Effect.fail(
              new KeyValueStoreError({ method: 'lifecycle', message: 'State service is closed.' }),
            )
          : Effect.acquireUseRelease(Effect.forkIn(effect, owner), Fiber.join, Fiber.interrupt),
    );
  return {
    /** Logical keys belong to the app/plugin, never to a backend. Schema codecs own JSON encoding. */
    document: <S extends Schema.Constraint>(key: string, schema: S) => {
      const codec = Schema.fromJsonString(Schema.toCodecJson(schema));
      const decode = Schema.decodeEffect(codec);
      const encode = Schema.encodeEffect(codec);
      const read = Effect.flatMap(storage.get(key), (text) =>
        text === undefined ? Effect.succeedNone : Effect.asSome(decode(text)),
      );
      const write = (value: S['Type']) =>
        Effect.flatMap(encode(value), (text) => storage.set(key, text));
      return {
        get: guard(read),
        set: (value: S['Type']) => guard(Semaphore.withPermits(lock, 1)(write(value))),
        remove: guard(Semaphore.withPermits(lock, 1)(storage.remove(key))),
        /** Re-read, validate and write under the same process-local lock; errors preserve storage. */
        modify: <E, R>(f: (current: Option.Option<S['Type']>) => Effect.Effect<S['Type'], E, R>) =>
          guard(
            Semaphore.withPermits(
              lock,
              1,
            )(
              Effect.gen(function* () {
                const next = yield* f(yield* read);
                yield* write(next);
                return next;
              }),
            ),
          ),
      };
    },
  };
});
export type Controller = Effect.Success<typeof make>;
export class PersistentState extends Context.Service<PersistentState, Controller>()(
  '@nixfiles/system-control/PersistentState',
) {
  static readonly layer = Layer.effect(PersistentState, make);
}
