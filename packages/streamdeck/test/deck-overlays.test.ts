import { assert, it } from '@effect/vitest';
import { IntegrationError } from '@nixfiles/system-control/errors.ts';
import {
  Desktop,
  DesktopBackend,
  make as makeDesktop,
  type Window,
} from '@nixfiles/system-control/desktop.ts';
import { NodeServices } from '@effect/platform-node';
import {
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  Ref,
  Result,
  Schedule,
  Scope,
  Stream,
} from 'effect';
import { DeckOverlays, make, type KeyOverlay, type Presentation } from '../src/deck-overlays.ts';
import * as Host from '../src/plugin-host.ts';
import * as Plugin from '../src/plugin.ts';
import * as Mock from '../src/mock.ts';
import * as ContextLayout from '../src/plugins/context-layout.ts';
import { startStudio } from '../src/scripts/studio.ts';
import { demoLayer } from '@nixfiles/system-control/audio.ts';
import { FileSystem } from 'effect';
import * as Drafts from '../web/profile-draft.ts';

const counter = (label: string, start = 0) => ({
  label,
  action: 'counter' as const,
  parameters: { start },
});
const layout = (label: string, key: number, priority = 0): KeyOverlay => ({
  name: label,
  priority,
  keys: { [key]: counter(label) },
});

it.effect(
  'arbitrates overlaps per key by priority then activation, and restores hidden presentations',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = yield* make([0, 1, 2]);
        const first = yield* registry
          .forOwner('game')
          .open('hud', { name: 'Game', keys: { 0: counter('Game'), 1: counter('Other') } });
        const later = yield* registry.forOwner('discord').open('call', layout('Discord', 0));
        assert.strictEqual((yield* registry.snapshot).keys.get(0)?.owner, 'discord');
        assert.strictEqual((yield* registry.snapshot).keys.get(1)?.owner, 'game');
        const priority = yield* registry.forOwner('alert').open('alert', layout('Alert', 0, 10));
        yield* later.update(layout('Discord updated', 0));
        assert.strictEqual((yield* registry.snapshot).keys.get(0)?.owner, 'alert');
        yield* first.close;
        yield* first.close;
        assert.strictEqual((yield* registry.snapshot).keys.get(0)?.owner, 'alert');
        assert.strictEqual((yield* registry.snapshot).keys.has(1), false);
        yield* priority.close;
        assert.strictEqual((yield* registry.snapshot).keys.get(0)?.owner, 'discord');
        yield* later.update(null);
        assert.strictEqual((yield* registry.snapshot).keys.size, 0);
      }),
    ),
);

it.effect(
  'equal source ticks preserve revision/order, null masks keys and reactivation gets a new address',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = yield* make([0, 1]);
        const value: KeyOverlay = { name: 'Game', keys: { 0: null } };
        const first = yield* registry.forOwner('game').open('hud', value);
        const initial = yield* registry.snapshot;
        assert.strictEqual(initial.keys.get(0)?.entry, null);
        assert.strictEqual(initial.keys.has(1), false);
        yield* first.update(structuredClone(value));
        assert.strictEqual((yield* registry.snapshot).revision, initial.revision);
        const second = yield* registry.forOwner('other').open('hud', layout('Other', 0));
        yield* first.update(value);
        assert.strictEqual((yield* registry.snapshot).keys.get(0)?.owner, 'other');
        yield* first.update(null);
        yield* first.update(value);
        assert.strictEqual((yield* registry.snapshot).keys.get(0)?.owner, 'game');
        assert.notStrictEqual(
          (yield* registry.snapshot).keys.get(0)?.address,
          initial.keys.get(0)?.address,
        );
        yield* second.close;
      }),
    ),
);

it.effect(
  'invalid updates are atomic, duplicate IDs reject and retained handles are revoked with their scope',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = yield* make([0]);
        const scope = yield* Scope.make();
        const api = registry.forOwner('game');
        const presentation = yield* api.open('hud', layout('Game', 0)).pipe(Scope.provide(scope));
        const before = yield* registry.snapshot;
        assert.ok(Result.isFailure(yield* Effect.result(api.open('hud'))));
        assert.ok(
          Result.isFailure(yield* Effect.result(presentation.update(layout('Invalid', 4)))),
        );
        assert.strictEqual((yield* registry.snapshot).revision, before.revision);
        yield* Scope.close(scope, Exit.void);
        assert.strictEqual((yield* registry.snapshot).keys.size, 0);
        assert.ok(Result.isFailure(yield* Effect.result(presentation.update(layout('Stale', 0)))));
        const replacement = yield* api.open('hud', layout('New', 0));
        yield* presentation.close;
        assert.strictEqual((yield* registry.snapshot).keys.size, 1);
        yield* replacement.close;
      }),
    ),
);

it.live('plugin disable and source failure release only the owning overlays', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const mock = Mock.make();
      yield* Effect.gen(function* () {
        const host = yield* Host.make;
        const failure = yield* Deferred.make<never, string>();
        const installed = yield* host.install(
          Plugin.define({
            id: 'context',
            name: 'Context',
            description: '',
            controls: {},
            setup: Effect.gen(function* () {
              const overlays = yield* DeckOverlays;
              const api = yield* overlays.open('hud', layout('Context', 0));
              return { api: { presentation: api, overlays }, run: Deferred.await(failure) };
            }),
          }),
        );
        const other = yield* host.overlays.forOwner('other').open('hud', layout('Other', 1));
        yield* host.setEnabled('context', true);
        const old = Option.getOrThrow(yield* installed.current);
        assert.strictEqual((yield* host.overlays.snapshot).keys.size, 2);
        yield* host.setEnabled('context', false);
        assert.strictEqual((yield* host.overlays.snapshot).keys.size, 1);
        assert.ok(
          Result.isFailure(yield* Effect.result(old.presentation.update(layout('Stale', 0)))),
        );
        assert.ok(
          Result.isFailure(
            yield* Effect.result(old.overlays.open('resurrect', layout('Stale', 0))),
          ),
        );
        yield* host.setEnabled('context', true);
        assert.ok(
          Result.isFailure(
            yield* Effect.result(old.overlays.open('resurrect', layout('Stale', 0))),
          ),
        );
        yield* Deferred.fail(failure, 'source failed');
        yield* Effect.repeat(host.snapshot, {
          until: (snapshot) => snapshot.items[0]?.phase === 'error',
          schedule: Schedule.spaced(5),
        }).pipe(Effect.timeout('2 seconds'));
        assert.strictEqual((yield* host.overlays.snapshot).keys.size, 1);
        yield* other.close;
      }).pipe(Effect.provide(mock.layer()));
    }),
  ),
);

it('matches compositor IDs exactly, not window titles or unrelated apps', () => {
  const rules = [{ applications: ['discord'], overlay: layout('Discord', 0) }];
  assert.strictEqual(ContextLayout.select(rules, { id: 1, app_id: 'Discord' })?.name, 'Discord');
  assert.strictEqual(ContextLayout.select(rules, { id: 1, app_id: 'discord-other' }), null);
  assert.strictEqual(ContextLayout.select(rules, null), null);
});

it.live(
  'foreground switching, desktop failure and recovery select overlays without closing shared services',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const mock = Mock.make();
        yield* Effect.gen(function* () {
          const windows = yield* Ref.make<Result.Result<ReadonlyArray<Window>, IntegrationError>>(
            Result.succeed([{ id: 1, app_id: 'discord', is_focused: true }]),
          );
          const desktop = yield* makeDesktop.pipe(
            Effect.provideService(DesktopBackend, {
              applications: Effect.succeed([]),
              windows: Ref.get(windows).pipe(Effect.flatMap(Effect.fromResult)),
              launch: () => Effect.die('Unexpected launch'),
              focus: () => Effect.die('Unexpected focus'),
            }),
          );
          const host = yield* Host.make;
          yield* host
            .install(
              ContextLayout.plugin([
                { applications: ['discord'], overlay: layout('Discord', 0) },
                { applications: ['game'], overlay: layout('Game', 0) },
              ]),
            )
            .pipe(Effect.provideService(Desktop, desktop));
          const expect = (name: string | undefined) =>
            Effect.repeat(host.overlays.snapshot, {
              until: (snapshot) => snapshot.keys.get(0)?.name === name,
              schedule: Schedule.spaced(5),
            }).pipe(Effect.timeout('2 seconds'));
          yield* host.setEnabled('context-layout', true);
          yield* expect('Discord');
          yield* Ref.set(
            windows,
            Result.succeed([
              { id: 1, app_id: 'discord', is_focused: false },
              { id: 2, app_id: 'game', is_focused: true },
            ]),
          );
          yield* desktop.refresh;
          yield* expect('Game');
          yield* Ref.set(windows, Result.succeed([{ id: 3, app_id: 'editor', is_focused: true }]));
          yield* desktop.refresh;
          yield* expect(undefined);
          yield* Ref.set(windows, Result.succeed([{ id: 1, app_id: 'discord', is_focused: true }]));
          yield* desktop.refresh;
          yield* expect('Discord');
          yield* Ref.set(
            windows,
            Result.fail(new IntegrationError({ message: 'Desktop offline' })),
          );
          yield* desktop.refresh.pipe(Effect.ignore);
          yield* expect(undefined);
          yield* Ref.set(windows, Result.succeed([{ id: 1, app_id: 'discord', is_focused: true }]));
          yield* desktop.refresh;
          yield* expect('Discord');
          yield* host.setEnabled('context-layout', false);
          yield* expect(undefined);
          assert.strictEqual((yield* desktop.focused)?.app_id, 'discord');
        }).pipe(Effect.provide(mock.layer()));
      }),
    ),
);

it.live(
  'a plugin can select and clear overlays from any Stream, without owning physical controls',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const mock = Mock.make();
        yield* Effect.gen(function* () {
          const host = yield* Host.make;
          const seen: string[] = [];
          yield* host.install(
            ContextLayout.fromSource({
              id: 'stream-context',
              name: 'Events',
              source: Stream.make('game', 'other', 'discord'),
              select: (event) => {
                seen.push(event);
                return event === 'other' ? null : layout(event, 0);
              },
            }),
          );
          yield* host.setEnabled('stream-context', true);
          const ready = yield* Effect.repeat(host.overlays.snapshot, {
            until: (snapshot) => snapshot.keys.get(0)?.name === 'discord',
            schedule: Schedule.spaced(5),
          }).pipe(Effect.timeout('2 seconds'));
          assert.deepStrictEqual(seen, ['game', 'other', 'discord']);
          assert.strictEqual(ready.keys.get(0)?.owner, 'stream-context');
          assert.strictEqual((yield* host.snapshot).items[0]?.enabled, true);
          yield* host.setEnabled('stream-context', false);
          assert.strictEqual((yield* host.overlays.snapshot).keys.size, 0);
        }).pipe(Effect.provide(mock.layer()));
      }),
    ),
);

it.live(
  'Studio renders/routes the same temporary keys, restores base navigation and never saves overlays',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'deck-overlay-' });
        const file = `${directory}/profile.json`;
        const mock = Mock.make();
        yield* Effect.gen(function* () {
          let handle: Host.Handle<Presentation> | undefined;
          const heldStarted = yield* Deferred.make<void>();
          const heldReleased = yield* Deferred.make<void>();
          const studio = yield* startStudio({
            profile: file,
            mock: true,
            applications: [],
            configurePlugins: (host) =>
              host
                .install(
                  Plugin.define({
                    id: 'context',
                    name: 'Context',
                    description: '',
                    controls: {},
                    actions: [
                      Plugin.action({
                        id: 'hold',
                        name: 'Hold',
                        description: '',
                        input: Plugin.NoInput,
                        defaults: {},
                        interaction: 'hold',
                        run: (_api: Presentation, _input, invocation) =>
                          Effect.gen(function* () {
                            yield* Deferred.succeed(heldStarted, undefined);
                            assert.ok(invocation.released);
                            yield* invocation.released;
                            yield* Deferred.succeed(heldReleased, undefined);
                          }),
                      }),
                    ],
                    setup: Effect.gen(function* () {
                      const overlays = yield* DeckOverlays;
                      return { api: yield* overlays.open('hud', layout('Discord', 0)) };
                    }),
                  }),
                )
                .pipe(
                  Effect.tap((value) =>
                    Effect.sync(() => {
                      handle = value;
                    }),
                  ),
                ),
          });
          yield* studio.actions.save(0, counter('Base', 4));
          yield* studio.actions.save(1, counter('Unchanged', 2));
          const base = yield* studio.snapshot;
          const disk = yield* fs.readFileString(file);
          const baseImage = yield* studio.preview.png('key', 0);
          yield* studio.setPlugin({ id: 'context', enabled: true, expected: false });
          const active = yield* studio.snapshot;
          assert.strictEqual(active.keys[0]?.binding?.label, 'Discord');
          assert.strictEqual(active.keys[0]?.overlay?.owner, 'context');
          assert.strictEqual(active.keys[1]?.binding?.label, 'Unchanged');
          assert.strictEqual(Drafts.project(Drafts.begin(active), active, undefined), active);
          assert.strictEqual(active.configuration.revision, base.configuration.revision);
          yield* Effect.repeat(studio.snapshot, {
            until: (snapshot) => (snapshot.keys[0]?.revision ?? 0) > (base.keys[0]?.revision ?? 0),
            schedule: Schedule.spaced(5),
          }).pipe(Effect.timeout('2 seconds'));
          assert.notDeepEqual(yield* studio.preview.png('key', 0), baseImage);
          yield* studio.actions.press(0);
          assert.strictEqual((yield* studio.snapshot).keys[0]?.count, 1);
          assert.ok(
            Result.isFailure(yield* Effect.result(studio.actions.save(0, counter('Wrong')))),
          );
          // A stale browser address cannot execute an underlying or replacement action.
          assert.ok(
            Result.isFailure(
              yield* Effect.result(
                studio.actions.keyInput(
                  0,
                  'down',
                  base.keys[0]?.address,
                  'web',
                  base.layout.revision,
                ),
              ),
            ),
          );
          assert.ok(handle);
          yield* handle.use((presentation) =>
            presentation.update({
              name: 'Long press',
              keys: {
                0: { ...counter('Long'), trigger: { type: 'long-press', milliseconds: 100 } },
              },
            }),
          );
          const pending = yield* studio.snapshot;
          yield* studio.actions.keyInput(
            0,
            'down',
            pending.keys[0]?.address,
            'web',
            pending.layout.revision,
          );
          yield* handle.use((presentation) => presentation.update(null));
          yield* Effect.sleep(150);
          yield* studio.actions.keyInput(
            0,
            'up',
            pending.keys[0]?.address,
            'web',
            pending.layout.revision,
          );
          const restored = yield* studio.snapshot;
          assert.strictEqual(restored.keys[0]?.binding?.label, 'Base');
          assert.strictEqual(restored.keys[0]?.count, 4);
          yield* Effect.repeat(studio.preview.png('key', 0), {
            until: (image) =>
              image.length === baseImage.length &&
              image.every((byte, index) => byte === baseImage[index]),
            schedule: Schedule.spaced(5),
          }).pipe(Effect.timeout('2 seconds'));
          assert.strictEqual(yield* fs.readFileString(file), disk);
          assert.deepStrictEqual(restored.configuration.navigation, base.configuration.navigation);
          yield* handle.use((presentation) =>
            presentation.update({
              name: 'Hold',
              keys: {
                0: {
                  label: 'Hold',
                  action: 'plugin',
                  parameters: { plugin: 'context', command: 'hold', input: {} },
                },
              },
            }),
          );
          const held = yield* studio.snapshot;
          yield* studio.keyInput({
            key: 0,
            phase: 'down',
            address: held.keys[0]!.address,
            revision: held.layout.revision,
          });
          yield* Deferred.await(heldStarted).pipe(Effect.timeout('2 seconds'));
          yield* handle.use((presentation) => presentation.update(null));
          // Release keeps its original address even though the visible key now belongs to the base.
          yield* studio.keyInput({
            key: 0,
            phase: 'up',
            address: held.keys[0]!.address,
            revision: held.layout.revision,
          });
          yield* Deferred.await(heldReleased).pipe(Effect.timeout('2 seconds'));
          assert.strictEqual(yield* fs.readFileString(file), disk);
          yield* studio.setPlugin({ id: 'context', enabled: false, expected: true });
        }).pipe(Effect.provide(Layer.mergeAll(mock.layer(), demoLayer)));
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);
