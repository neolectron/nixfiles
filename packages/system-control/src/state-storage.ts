import { Context, Effect, Layer } from 'effect';
import * as KeyValueStore from 'effect/persistence/KeyValueStore';

/** The subset of Effect's storage contract needed by application state.
 * No global clear/size: this adapter can share a directory or database with other data.
 */
export type Adapter = Pick<KeyValueStore.KeyValueStore, 'get' | 'set' | 'remove'>;
export class StateStorage extends Context.Service<StateStorage, Adapter>()(
  '@nixfiles/system-control/StateStorage',
) {
  /** Reuse any upstream KeyValueStore Layer (memory, SQL, Web Storage, custom…). */
  static readonly layerKeyValueStore = Layer.effect(
    StateStorage,
    Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore;
      return { get: store.get, set: store.set, remove: store.remove };
    }),
  );
  static readonly layerMemory = StateStorage.layerKeyValueStore.pipe(
    Layer.provide(KeyValueStore.layerMemory),
  );
}
