import { assert, it } from '@effect/vitest';
import { Effect, Ref, Schema, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import * as Input from '../src/studio-input.ts';
import * as Sync from '../src/studio-sync.ts';
import * as Contexts from '../src/context-rules.ts';
import * as Plugin from '../src/plugin.ts';
import * as Host from '../src/plugin-host.ts';
import * as Mock from '../src/mock.ts';
import type { Snapshot } from '../src/studio-contract.ts';
import { Snapshot as SnapshotSchema } from '../src/studio-contract.ts';
import * as Rules from '../src/studio-layout.ts';

it.effect(
  'a tile binds short, long and double press independently, using exclusive library arbitration',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const calls = yield* Ref.make<string[]>([]);
        const binding = (label: string) => ({
          label,
          action: 'counter' as const,
          parameters: { start: 0 },
        });
        const router = yield* Input.make({
          validateKey: () => Effect.void,
          validate: () => Effect.void,
          resolve: () =>
            Effect.succeed({
              address: 'one',
              revision: 0,
              binding: binding('short'),
              gestures: {
                longPress: {
                  ...binding('long'),
                  trigger: { type: 'long-press', milliseconds: 100 },
                },
                doubleTap: {
                  ...binding('double'),
                  trigger: { type: 'double-tap', milliseconds: 100 },
                },
              },
            }),
          press: (_, activation) =>
            Ref.update(calls, (before) => [...before, activation.action?.label ?? '']),
          release: () => Effect.void,
        });
        const tap = router.input(0, 'down').pipe(Effect.andThen(router.input(0, 'up')));
        yield* tap;
        assert.deepStrictEqual(yield* Ref.get(calls), []);
        yield* TestClock.adjust(100);
        assert.deepStrictEqual(yield* Ref.get(calls), ['short']);
        yield* tap;
        yield* TestClock.adjust(50);
        yield* tap;
        assert.deepStrictEqual(yield* Ref.get(calls), ['short', 'double']);
        yield* router.input(0, 'down');
        yield* TestClock.adjust(100);
        assert.deepStrictEqual(yield* Ref.get(calls), ['short', 'double', 'long']);
        yield* router.input(0, 'up');
        yield* TestClock.adjust(400);
        assert.deepStrictEqual(yield* Ref.get(calls), ['short', 'double', 'long']);
        yield* router.input(0, 'down');
        yield* router.input(0, 'cancel');
        yield* TestClock.adjust(600);
        assert.strictEqual((yield* Ref.get(calls)).length, 3);
      }),
    ),
);

it.effect(
  'plugin manifests export multiple templates for one action without activating the backend',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const host = yield* Host.make;
        let activations = 0;
        const definition = Plugin.define({
          id: 'presets',
          name: 'Presets',
          description: '',
          controls: {},
          setup: Effect.sync(() => {
            activations++;
            return { api: {} };
          }),
          actions: [
            Plugin.action({
              id: 'run',
              name: 'Run',
              description: '',
              input: Plugin.NoInput,
              defaults: {},
              run: () => Effect.void,
            }),
          ],
          tiles: [
            { id: 'one', action: 'run', label: 'One', icon: 'custom.icon', input: {} },
            { id: 'two', action: 'run', label: 'Two', icon: 'plugin', input: {} },
          ],
        });
        yield* host.install(definition);
        assert.strictEqual(activations, 0);
        assert.strictEqual((yield* host.catalogue).length, 1);
        assert.strictEqual((yield* host.templates).length, 2);
        assert.strictEqual((yield* host.manifests)[0]?.apiVersion, 1);
        yield* host.setEnabled('presets', true);
        assert.strictEqual(activations, 1);
      }),
    ).pipe(Effect.provide(Mock.make().layer())),
);

it('context rules select an explicit deterministic priority and reject invalid placements', () => {
  const rules = [
    { id: 'low', name: 'Low', priority: 0, applications: ['discord'], keys: {} },
    { id: 'high', name: 'High', priority: 10, applications: ['Discord'], keys: { '0': null } },
  ];
  assert.strictEqual(Contexts.select(rules, 'DISCORD')?.id, 'high');
  assert.strictEqual(Contexts.select(rules, 'spotify'), undefined);
  const profile = {
    version: 2 as const,
    zones: [{ id: 'deck', name: 'Deck', keys: [0], items: [], pinned: {} }],
    folders: [],
    contexts: rules,
  };
  Rules.validate(profile, [0]);
  assert.throws(() =>
    Rules.validate({ ...profile, contexts: [{ ...rules[0]!, keys: { '99': null } }] }, [0]),
  );
});

it.effect('SSE sends only changed domains and reconnects with a complete snapshot after gaps', () =>
  Effect.gen(function* () {
    const initial: Snapshot = Schema.decodeUnknownSync(SnapshotSchema)({
      sessionId: 'session',
      stateRevision: 1,
      inputSequence: 0,
      configuration: {
        profile: { version: 2, zones: [], folders: [] },
        navigation: {},
        revision: 0,
      },
      layout: { revision: 0, zones: [], folders: [] },
      plugins: { revision: 0, items: [] },
      connected: false,
      connectionError: null,
      mock: true,
      model: 'Demo',
      page: 0,
      pages: 1,
      lastEvent: '',
      keys: [],
      lcds: [],
      dials: [],
      discordConnection: { clientId: '', configured: false, authorized: false },
    });
    const next = { ...initial, stateRevision: 2, lastEvent: 'external change' };
    const events = yield* Stream.runCollect(Sync.events(Stream.make(initial, next)));
    const first = events[0]!,
      patch = events[1]!;
    assert.strictEqual(first.kind, 'snapshot');
    assert.strictEqual(patch.kind, 'patch');
    if (patch.kind !== 'patch') return;
    assert.deepStrictEqual(Object.keys(patch.changes).sort(), ['lastEvent', 'stateRevision']);
    assert.deepStrictEqual(Sync.apply(initial, patch), next);
    assert.throws(() => Sync.apply({ ...initial, stateRevision: 0 }, patch));
    assert.deepStrictEqual(Sync.apply(undefined, first), initial);
  }),
);
