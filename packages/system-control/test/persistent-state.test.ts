import { assert, it } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Ref,
  Result,
  Schema,
  Scope,
} from 'effect';
import * as KeyValueStore from 'effect/persistence/KeyValueStore';
import { PersistentState, make } from '../src/persistent-state.ts';
import { StateStorage } from '../src/state-storage.ts';
import * as Files from '../src/state-storage-file.ts';
import * as Notes from '../src/notes.ts';

const Counter = Schema.Struct({ count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) });
const contract = Effect.gen(function* () {
  const state = yield* PersistentState;
  const a = state.document('plugins/a/state.v1.json', Counter);
  const b = state.document('plugins/b/state.v1.json', Counter);
  assert.ok(Option.isNone(yield* a.get));
  yield* a.set({ count: 0 });
  yield* b.set({ count: 500 });
  yield* Effect.all(
    Array.from({ length: 50 }, () =>
      a.modify((current) =>
        Effect.yieldNow.pipe(Effect.as({ count: Option.getOrThrow(current).count + 1 })),
      ),
    ),
    { concurrency: 'unbounded' },
  );
  assert.strictEqual(Option.getOrThrow(yield* a.get).count, 50);
  assert.strictEqual(Option.getOrThrow(yield* b.get).count, 500);
  assert.ok(Result.isFailure(yield* Effect.result(a.set({ count: -1 }))));
  const rejected = yield* Effect.result(a.modify(() => Effect.fail('Business conflict')));
  assert.ok(Result.isFailure(rejected));
  if (Result.isFailure(rejected)) assert.strictEqual(rejected.failure, 'Business conflict');
  assert.strictEqual(Option.getOrThrow(yield* a.get).count, 50);
  const raw = yield* StateStorage;
  yield* raw.set('plugins/a/state.v1.json', '{"count":"invalid"}');
  assert.ok(Result.isFailure(yield* Effect.result(a.get)));
  assert.ok(Result.isFailure(yield* Effect.result(a.modify(() => Effect.succeed({ count: 0 })))));
  assert.strictEqual(yield* raw.get('plugins/a/state.v1.json'), '{"count":"invalid"}');
  yield* a.remove;
  yield* a.remove;
  assert.ok(Option.isNone(yield* a.get));
  assert.ok(Option.isSome(yield* b.get));
});
it.effect('the upstream memory adapter passes the typed state contract', () =>
  Effect.scoped(
    contract.pipe(
      Effect.provide(PersistentState.layer.pipe(Layer.provideMerge(StateStorage.layerMemory))),
    ),
  ),
);
it.live('the atomic file adapter passes the same contract', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: 'state-contract-' });
      const context = yield* Layer.build(
        PersistentState.layer.pipe(Layer.provideMerge(Files.layer(root))),
      );
      yield* contract.pipe(Effect.provideContext(context));
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);
it.live(
  'file storage reopens existing JSON, writes privately and atomically, and rejects path escapes',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: 'state-file-' });
        const file = `${root}/profile with spaces.json`;
        yield* fs.writeFileString(file, '{"count":7}');
        const open = Effect.gen(function* () {
          const context = yield* Layer.build(
            PersistentState.layer.pipe(Layer.provideMerge(Files.layer(root))),
          );
          return {
            state: Context.get(context, PersistentState),
            raw: Context.get(context, StateStorage),
          };
        });
        yield* Effect.scoped(
          Effect.gen(function* () {
            const { state, raw } = yield* open;
            const doc = state.document('profile with spaces.json', Counter);
            assert.strictEqual(Option.getOrThrow(yield* doc.get).count, 7);
            yield* doc.set({ count: 8 });
            assert.strictEqual((yield* fs.stat(file)).mode & 0o777, 0o600);
            yield* state.document('notes/one.json', Counter).set({ count: 1 });
            assert.strictEqual((yield* fs.stat(`${root}/notes`)).mode & 0o777, 0o700);
            for (const key of ['', '.', '..', '../escape', '/absolute', 'a/../b', 'a\\b']) {
              assert.ok(Result.isFailure(yield* Effect.result(raw.set(key, 'bad'))));
              assert.ok(Result.isFailure(yield* Effect.result(raw.get(key))));
              assert.ok(Result.isFailure(yield* Effect.result(raw.remove(key))));
            }
            assert.deepStrictEqual((yield* fs.readDirectory(root)).sort(), [
              'notes',
              'profile with spaces.json',
            ]);
          }),
        );
        const { state } = yield* open;
        assert.strictEqual(
          Option.getOrThrow(yield* state.document('profile with spaces.json', Counter).get).count,
          8,
        );
        assert.strictEqual(
          Option.getOrThrow(yield* state.document('notes/one.json', Counter).get).count,
          1,
        );
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);
it.effect('scope closure cancels in-flight adapter operations and revokes retained documents', () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const stopped = yield* Ref.make(false);
    const owner = yield* Scope.make();
    const services = yield* Layer.build(
      PersistentState.layer.pipe(
        Layer.provide(
          Layer.succeed(StateStorage, {
            get: () => Effect.undefined,
            remove: () => Effect.void,
            set: () =>
              Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(Ref.set(stopped, true)),
              ),
          }),
        ),
      ),
    ).pipe(Scope.provide(owner));
    const doc = Context.get(services, PersistentState).document('test', Counter);
    const job = yield* Effect.forkChild(doc.set({ count: 1 }));
    yield* Deferred.await(entered);
    yield* Scope.close(owner, Exit.void);
    yield* Fiber.await(job);
    assert.strictEqual(yield* Ref.get(stopped), true);
    for (const operation of [doc.get, doc.set({ count: 2 }), doc.remove]) {
      const result = yield* Effect.result(operation);
      assert.ok(Result.isFailure(result));
      if (Result.isFailure(result))
        assert.instanceOf(result.failure, KeyValueStore.KeyValueStoreError);
    }
  }),
);
it.effect(
  'notes share process-local atomic updates across separate service instances and preserve failed writes',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(StateStorage.layerMemory);
        const raw = Context.get(context, StateStorage);
        let offline = false;
        const backend = Layer.succeed(StateStorage, {
          ...raw,
          set: (key, value) =>
            offline
              ? Effect.fail(
                  new KeyValueStore.KeyValueStoreError({ method: 'set', key, message: 'Offline' }),
                )
              : raw.set(key, value),
        });
        yield* Effect.gen(function* () {
          const one = yield* Notes.makeWithState();
          const two = yield* Notes.makeWithState();
          yield* one.ensure('shared', 'Shared');
          yield* Effect.all([one.append('shared', 'One'), two.append('shared', 'Two')], {
            concurrency: 'unbounded',
          });
          const before = yield* one.read('shared');
          assert.strictEqual(before.body, 'One\nTwo');
          offline = true;
          assert.ok(Result.isFailure(yield* Effect.result(two.append('shared', 'Lost'))));
          assert.deepStrictEqual(yield* one.read('shared'), before);
        }).pipe(Effect.provide(PersistentState.layer.pipe(Layer.provide(backend))));
      }),
    ),
);
