import { assert, it } from '@effect/vitest';
import { Effect, Ref, Stream } from 'effect';
import { make, accept } from '../src/studio-state.ts';
import type { Snapshot } from '../src/studio-contract.ts';

const initial = {
  sessionId: 'one',
  inputSequence: 0,
  plugins: { revision: 0, items: [] },
  layout: { revision: 0, zones: [], folders: [] },
  keys: [],
  lcds: [],
  dials: [],
} as unknown as Snapshot;

it.effect(
  'shared state sequences non-input changes and subscribers receive the same revision',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const source = yield* Ref.make(initial);
        let reads = 0;
        const store = yield* make(
          Ref.get(source).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                reads++;
              }),
            ),
          ),
          1000,
        );
        const one = yield* store.refresh;
        const two = yield* store.refresh;
        assert.strictEqual(one.stateRevision, two.stateRevision);
        yield* Ref.set(source, { ...initial, lastEvent: 'external volume change' });
        const newer = yield* store.refresh;
        assert.ok(newer.stateRevision! > one.stateRevision!);
        assert.strictEqual(accept(newer, one), newer);
        const readsBeforeSubscribers = reads;
        const subscribers = yield* Effect.all(
          [Stream.runHead(store.observe), Stream.runHead(store.observe)],
          { concurrency: 'unbounded' },
        );
        assert.deepStrictEqual(subscribers[0], subscribers[1]);
        assert.strictEqual(reads, readsBeforeSubscribers);
        assert.strictEqual((yield* store.cached).stateRevision, newer.stateRevision);
        assert.strictEqual(accept(newer, { ...one, sessionId: 'two' }).sessionId, 'two');
      }),
    ),
);
