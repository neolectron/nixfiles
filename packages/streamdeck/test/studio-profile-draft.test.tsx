import { assert, it } from '@effect/vitest';
import { NodeServices, NodeHttpServer } from '@effect/platform-node';
import { Effect, FileSystem, Layer, Schedule } from 'effect';
import { renderToStaticMarkup } from 'react-dom/server';
import { HttpClient, HttpClientRequest, HttpServer } from 'effect/http';
import * as Mock from '../src/mock.ts';
import * as Actions from '../src/studio-actions.tsx';
import * as Layout from '../src/studio-layout.ts';
import * as Drafts from '../web/profile-draft.ts';
import { draftOf } from '../web/key-draft.ts';
import { KeyGrid } from '../web/key-grid.tsx';
import type { Catalogue, Snapshot } from '../src/studio-contract.ts';
import { demoLayer } from '@nixfiles/system-control/audio.ts';
import { startStudio, httpApp } from '../src/scripts/studio.ts';
const catalogue: Catalogue = { actions: Actions.catalogue, applications: [], pluginActions: [] };
const ids = { entry: 'folder-tile', folder: 'folder', zone: 'zone' };
const key = (snapshot: Snapshot, index: number) =>
  snapshot.keys.find((key) => key.index === index)!;
const withStudio = (
  run: (
    studio: Effect.Success<ReturnType<typeof startStudio>>,
    mock: ReturnType<typeof Mock.make>,
    file: string,
  ) => Effect.Effect<void, unknown, FileSystem.FileSystem>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-profile-draft-' });
      const file = `${directory}/profile.json`;
      const mock = Mock.make();
      yield* Effect.gen(function* () {
        const studio = yield* startStudio({ profile: file, mock: true, applications: [] });
        yield* studio.actions.save(0, {
          action: 'counter',
          label: 'Original',
          parameters: { start: 4 },
        });
        yield* run(studio, mock, file);
      }).pipe(Effect.provide(Layer.mergeAll(mock.layer(), demoLayer)));
    }),
  ).pipe(Effect.provide(NodeServices.layer));

it.live(
  'only edited and moved slots lock while unchanged keys retain live state and execute the saved action',
  () =>
    withStudio((studio) =>
      Effect.gen(function* () {
        yield* studio.actions.save(1, {
          action: 'counter',
          label: 'Untouched',
          parameters: { start: 6 },
        });
        const before = yield* studio.snapshot;
        const original = key(before, 0);
        const form = draftOf(original.binding, catalogue);
        const edited = Drafts.edit(
          Drafts.begin(before),
          original,
          { ...form, label: 'Edited' },
          catalogue,
          'unused',
        );
        let preview = Drafts.project(edited, before, catalogue);
        const pending = Drafts.pendingKeys(edited, preview, before);
        assert.deepStrictEqual([...pending], [0]);
        assert.strictEqual(key(preview, 1), key(before, 1));
        const html = renderToStaticMarkup(
          <KeyGrid
            snapshot={preview}
            selected={null}
            editable={true}
            interactive={true}
            draft={true}
            pendingKeys={pending}
            empty={null}
            onSelect={() => {}}
            onSnapshot={() => {}}
            onOrganize={() => Effect.never}
            onNavigate={() => Effect.never}
            onRemove={() => Effect.never}
          />,
        );
        assert.match(html, /aria-label="Touche 1 · Edited"[^>]*disabled=""/);
        assert.notMatch(html, /aria-label="Touche 2 · Untouched"[^>]*disabled=""/);
        yield* studio.actions.press(1, key(preview, 1).address);
        const live = yield* Effect.repeat(studio.snapshot, {
          until: (state) => key(state, 1).count === 7,
          schedule: Schedule.spaced(1),
        });
        preview = Drafts.project(edited, live, catalogue);
        assert.strictEqual(key(preview, 1).count, 7);
        assert.deepStrictEqual([...Drafts.pendingKeys(edited, preview, live)], [0]);
        assert.strictEqual(key(live, 0).binding?.label, 'Original');
        const reverted = Drafts.edit(edited, key(preview, 0), form, catalogue, 'unused');
        assert.deepStrictEqual(
          [...Drafts.pendingKeys(reverted, Drafts.project(reverted, live, catalogue), live)],
          [],
        );
        const moved = Drafts.organize(
          Drafts.begin(live),
          catalogue,
          {
            operation: 'exchange',
            source: 0,
            target: 1,
            sourceAddress: key(live, 0).address,
            targetAddress: key(live, 1).address,
            revision: live.layout.revision,
          },
          ids,
          live.keys.map((item) => item.index),
        );
        assert.deepStrictEqual(
          [...Drafts.pendingKeys(moved, Drafts.project(moved, live, catalogue), live)],
          [0, 1],
        );
      }),
    ).pipe(Effect.timeout('5 seconds')),
);

it.live(
  'LCD edits do not lock keys, but new, deleted and incomplete shortcuts lock only their own slot',
  () =>
    withStudio((studio) =>
      Effect.gen(function* () {
        const before = yield* studio.snapshot;
        const lcd: Drafts.ProfileDraft = {
          ...Drafts.begin(before),
          profile: { ...before.configuration.profile, lcd: { zones: [], folders: [] } },
        };
        assert.ok(Drafts.dirty(lcd));
        assert.deepStrictEqual(
          [...Drafts.pendingKeys(lcd, Drafts.project(lcd, before, catalogue), before)],
          [],
        );
        const create = Drafts.edit(
          Drafts.begin(before),
          key(before, 2),
          {
            ...draftOf(null, catalogue),
            action: 'counter',
            label: 'New',
            values: { start: '3' },
          },
          catalogue,
          'new',
        );
        assert.deepStrictEqual(
          [...Drafts.pendingKeys(create, Drafts.project(create, before, catalogue), before)],
          [2],
        );
        const invalid = Drafts.edit(
          Drafts.begin(before),
          key(before, 3),
          {
            ...draftOf(null, catalogue),
            action: 'run-command',
            label: 'Incomplete',
            values: { executable: '', arguments: '', directory: '' },
          },
          catalogue,
          'incomplete',
        );
        const invalidView = Drafts.project(invalid, before, catalogue);
        assert.strictEqual(key(invalidView, 3).binding, null);
        assert.deepStrictEqual([...Drafts.pendingKeys(invalid, invalidView, before)], [3]);
        const deleted = Drafts.remove(Drafts.begin(before), key(before, 0), catalogue);
        assert.deepStrictEqual(
          [...Drafts.pendingKeys(deleted, Drafts.project(deleted, before, catalogue), before)],
          [0],
        );
      }),
    ),
);

it.live(
  'multiple key drafts, rearrangement, folders and pages stay local until one atomic save',
  () =>
    withStudio((studio, mock, file) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const before = yield* studio.snapshot;
        const disk = yield* fs.readFileString(file);
        const writes = mock.writes.length;
        let draft = Drafts.begin(before);
        draft = Drafts.edit(
          draft,
          key(before, 0),
          {
            action: 'counter',
            label: 'Edited',
            values: { start: '8' },
            activation: 'long-press',
            milliseconds: '600',
          },
          catalogue,
          'unused',
        );
        draft = Drafts.edit(
          draft,
          key(before, 1),
          {
            action: 'counter',
            label: 'New',
            values: { start: '2' },
            activation: 'press',
            milliseconds: '600',
          },
          catalogue,
          'new-tile',
        );
        let preview = Drafts.project(draft, before, catalogue);
        assert.strictEqual(key(preview, 0).binding?.label, 'Edited');
        assert.strictEqual(Drafts.formOf(draft, key(preview, 0), catalogue).values.start, '8');
        draft = Drafts.organize(
          draft,
          catalogue,
          {
            operation: 'exchange',
            source: 0,
            target: 1,
            sourceAddress: key(preview, 0).address,
            targetAddress: key(preview, 1).address,
            revision: preview.layout.revision,
          },
          ids,
          before.keys.map((key) => key.index),
        );
        preview = Drafts.project(draft, before, catalogue);
        draft = Drafts.organize(
          draft,
          catalogue,
          {
            operation: 'create-folder',
            key: 3,
            name: 'Draft folder',
            address: key(preview, 3).address,
          },
          ids,
          before.keys.map((key) => key.index),
        );
        draft = Drafts.organize(
          draft,
          catalogue,
          { operation: 'add-page', zone: 'deck', revision: 0 },
          ids,
          before.keys.map((key) => key.index),
        );
        assert.strictEqual(Drafts.dirty(draft), true);
        assert.strictEqual(
          (yield* studio.snapshot).configuration.revision,
          before.configuration.revision,
        );
        assert.strictEqual(key(yield* studio.snapshot, 0).binding?.label, 'Original');
        assert.strictEqual(yield* fs.readFileString(file), disk);
        assert.strictEqual(mock.writes.length, writes);
        assert.strictEqual(Drafts.dirty(Drafts.begin(before)), false);
        yield* studio.actions.saveProfile(
          draft.profile,
          draft.navigation,
          before.configuration.revision,
          before.configuration.profile,
        );
        const saved = yield* studio.snapshot;
        assert.strictEqual(saved.layout.zones[0]!.pages, 2);
        assert.strictEqual(saved.layout.folders[0]!.name, 'Draft folder');
        assert.strictEqual(saved.configuration.revision, before.configuration.revision + 1);
        const stored = JSON.parse(yield* fs.readFileString(file));
        assert.strictEqual(stored.zones[0].items[0].binding.label, 'New');
        assert.strictEqual(stored.zones[0].items[1].binding.parameters.start, 8);
        assert.strictEqual(key(saved, 1).count, 0); // the saved page is empty; no action fired
        assert.ok(mock.writes.length > writes);
      }),
    ),
);

it.live(
  'deleting a shortcut stays local, rejects stale targets and saves without running its action',
  () =>
    withStudio((studio, mock, file) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const before = yield* studio.snapshot;
        const disk = yield* fs.readFileString(file);
        const writes = mock.writes.length;
        const chosen = key(before, 0);
        const draft = Drafts.remove(Drafts.begin(before), chosen, catalogue);
        assert.strictEqual(key(Drafts.project(draft, before, catalogue), 0).binding, null);
        assert.strictEqual(Drafts.dirty(draft), true);
        assert.throws(() => Drafts.remove(draft, chosen, catalogue), /changé/);
        for (const protectedKey of [
          { ...chosen, navigation: true },
          { ...chosen, pressed: true },
          { ...chosen, status: 'running' as const },
        ])
          assert.throws(() => Drafts.remove(Drafts.begin(before), protectedKey, catalogue));
        assert.strictEqual(yield* fs.readFileString(file), disk);
        assert.strictEqual(mock.writes.length, writes);
        assert.strictEqual(key(yield* studio.snapshot, 0).binding?.label, 'Original');
        const prepared = Drafts.materialize(draft, catalogue);
        yield* studio.actions.saveProfile(
          prepared.profile,
          prepared.navigation,
          before.configuration.revision,
          before.configuration.profile,
        );
        assert.strictEqual(key(yield* studio.snapshot, 0).binding, null);
        assert.strictEqual(
          JSON.parse(yield* fs.readFileString(file)).zones[0].items[0] ?? null,
          null,
        );
        assert.strictEqual(Drafts.dirty(Drafts.begin(before)), false); // Discard keeps the original profile.
      }),
    ),
);

it.live('deleting an incomplete new shortcut drops its form without disturbing other edits', () =>
  withStudio((studio) =>
    Effect.gen(function* () {
      const before = yield* studio.snapshot;
      const invalid = Drafts.edit(
        Drafts.begin(before),
        key(before, 1),
        {
          action: 'run-command',
          label: 'Incomplete',
          values: { executable: '', arguments: '', directory: '' },
          activation: 'press',
          milliseconds: '600',
        },
        catalogue,
        'incomplete',
      );
      assert.throws(() => Drafts.materialize(invalid, catalogue));
      const preview = Drafts.project(invalid, before, catalogue);
      const removed = Drafts.remove(invalid, key(preview, 1), catalogue);
      assert.strictEqual(Drafts.dirty(removed), false);
      assert.strictEqual(removed.forms.length, 0);
      assert.strictEqual(
        key(Drafts.project(removed, before, catalogue), 0).binding?.label,
        'Original',
      );
    }),
  ),
);

it.live(
  'deletion preserves edits displaced by a removed pin and removes folder contents independently',
  () =>
    withStudio((studio) =>
      Effect.gen(function* () {
        const before = yield* studio.snapshot;
        const profile = Layout.copy(before.configuration.profile);
        const zone = profile.zones[0]!;
        zone.pinned['0'] = zone.items[0]!;
        zone.items[0] = null;
        zone.items[1] = {
          id: 'other',
          binding: { action: 'counter', label: 'Other', parameters: { start: 2 } },
        };
        let state: Drafts.ProfileDraft = { ...Drafts.begin(before), profile };
        let preview = Drafts.project(state, before, catalogue);
        state = Drafts.edit(
          state,
          key(preview, 2),
          {
            action: 'counter',
            label: 'Other edited',
            values: { start: '5' },
            activation: 'press',
            milliseconds: '600',
          },
          catalogue,
          'unused',
        );
        preview = Drafts.project(state, before, catalogue);
        state = Drafts.remove(state, key(preview, 0), catalogue);
        preview = Drafts.project(state, before, catalogue);
        assert.strictEqual(key(preview, 0).binding, null);
        assert.strictEqual(key(preview, 1).binding?.label, 'Other edited');
        assert.deepStrictEqual(Drafts.materialize(state, catalogue).profile.zones[0]!.pinned, {});

        const folders = Layout.copy(before.configuration.profile);
        folders.folders.push({ id: 'tools', name: 'Tools', items: [folders.zones[0]!.items[0]!] });
        folders.zones[0]!.items[0] = {
          id: 'open-tools',
          binding: { action: 'open-folder', label: 'Tools', parameters: { folder: 'tools' } },
        };
        const root = { ...Drafts.begin(before), profile: folders };
        const rootView = Drafts.project(root, before, catalogue);
        const withoutLink = Drafts.materialize(
          Drafts.remove(root, key(rootView, 0), catalogue),
          catalogue,
        );
        assert.strictEqual(withoutLink.profile.folders[0]!.items[0]!.binding.label, 'Original');
        const opened = Drafts.navigate(root, catalogue, {
          zone: 'deck',
          operation: 'open',
          folder: 'tools',
        });
        const openedView = Drafts.project(opened, before, catalogue);
        assert.throws(() => Drafts.remove(opened, key(openedView, 0), catalogue)); // Automatic Back.
        const withoutContent = Drafts.materialize(
          Drafts.remove(opened, key(openedView, 1), catalogue),
          catalogue,
        );
        assert.strictEqual(withoutContent.profile.folders[0]!.items[0], null);
        assert.strictEqual(
          withoutContent.profile.zones[0]!.items[0]!.binding.action,
          'open-folder',
        );
      }),
    ),
);

it.live(
  'invalid layouts, invalid actions and concurrent saves leave disk and hardware unchanged',
  () =>
    withStudio((studio, mock, file) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const before = yield* studio.snapshot;
        const disk = yield* fs.readFileString(file);
        const writes = mock.writes.length;
        const invalidLayout = Layout.copy(before.configuration.profile);
        invalidLayout.zones[0]!.keys.push(99);
        assert.strictEqual(
          (yield* Effect.result(
            studio.actions.saveProfile(invalidLayout, {}, before.configuration.revision),
          ))._tag,
          'Failure',
        );
        const invalidPlugin = Layout.copy(before.configuration.profile);
        invalidPlugin.zones[0]!.items[0] = {
          id: 'invalid',
          binding: {
            action: 'plugin',
            label: 'Bad',
            parameters: { plugin: 'missing', command: 'missing', input: {} },
          },
        };
        assert.strictEqual(
          (yield* Effect.result(
            studio.actions.saveProfile(invalidPlugin, {}, before.configuration.revision),
          ))._tag,
          'Failure',
        );
        assert.strictEqual(yield* fs.readFileString(file), disk);
        assert.strictEqual(mock.writes.length, writes);
        yield* studio.actions.save(1, {
          action: 'counter',
          label: 'Other editor',
          parameters: { start: 9 },
        });
        const newerDisk = yield* fs.readFileString(file);
        const newerWrites = mock.writes.length;
        const stale = yield* Effect.result(
          studio.actions.saveProfile(
            before.configuration.profile,
            {},
            before.configuration.revision,
            before.configuration.profile,
          ),
        );
        assert.strictEqual(stale._tag, 'Failure');
        assert.strictEqual(yield* fs.readFileString(file), newerDisk);
        assert.strictEqual(mock.writes.length, newerWrites);
      }),
    ),
);

it.live(
  'navigation does not invalidate a configuration draft; invalid forms survive until corrected',
  () =>
    withStudio((studio, _mock, file) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const initial = yield* studio.snapshot;
        yield* studio.actions.organize({
          operation: 'add-page',
          zone: 'deck',
          revision: initial.layout.revision,
        });
        const before = yield* studio.snapshot;
        yield* studio.actions.navigate({ operation: 'previous', zone: 'deck' });
        assert.strictEqual(
          (yield* studio.snapshot).configuration.revision,
          before.configuration.revision,
        );
        let draft = Drafts.begin(before);
        const chosen = key(before, 1);
        draft = Drafts.edit(
          draft,
          chosen,
          {
            action: 'run-command',
            label: 'Incomplete',
            values: { executable: '', arguments: '', directory: '' },
            activation: 'press',
            milliseconds: '600',
          },
          catalogue,
          'new-command',
        );
        assert.throws(() => Drafts.materialize(draft, catalogue));
        assert.strictEqual(Drafts.formOf(draft, chosen, catalogue).label, 'Incomplete');
        const disk = yield* fs.readFileString(file);
        assert.strictEqual(key(yield* studio.snapshot, 1).binding, null);
        draft = Drafts.edit(
          draft,
          chosen,
          {
            action: 'counter',
            label: 'Corrected',
            values: { start: '7' },
            activation: 'press',
            milliseconds: '600',
          },
          catalogue,
          'same-command',
        );
        const prepared = Drafts.materialize(draft, catalogue);
        yield* studio.actions.saveProfile(
          prepared.profile,
          prepared.navigation,
          before.configuration.revision,
          before.configuration.profile,
        );
        assert.strictEqual(key(yield* studio.snapshot, 1).binding?.label, 'Corrected');
        assert.notStrictEqual(yield* fs.readFileString(file), disk);
      }),
    ),
);

it.live('HTTP profile saves reject foreign origins and stale engine sessions before writing', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-profile-http-' });
      const file = `${directory}/profile.json`;
      const mock = Mock.make();
      yield* Effect.gen(function* () {
        const studio = yield* startStudio({ profile: file, mock: true, applications: [] });
        const before = yield* studio.snapshot;
        const app = yield* httpApp(studio, ['http://127.0.0.1:3901']);
        yield* (yield* HttpServer.HttpServer).serve(app);
        const client = yield* HttpClient.HttpClient;
        const profile = Layout.copy(before.configuration.profile);
        Layout.replace(profile, {}, 0, {
          id: 'http',
          binding: { action: 'counter', label: 'Atomic HTTP', parameters: { start: 3 } },
        });
        const request = (origin: string, sessionId: string) =>
          HttpClientRequest.put('/api/profile').pipe(
            HttpClientRequest.bodyJsonUnsafe({
              profile,
              navigation: {},
              expectedRevision: before.configuration.revision,
              expectedProfile: before.configuration.profile,
              sessionId,
            }),
            HttpClientRequest.setHeaders({ origin, 'x-streamdeck-studio': '1' }),
          );
        assert.strictEqual(
          (yield* client.execute(request('https://foreign.example', before.sessionId))).status,
          403,
        );
        assert.strictEqual(
          (yield* client.execute(request('http://127.0.0.1:3901', 'stale'))).status,
          409,
        );
        assert.strictEqual(yield* fs.exists(file), false);
        assert.strictEqual(
          (yield* client.execute(request('http://127.0.0.1:3901', before.sessionId))).status,
          200,
        );
        assert.strictEqual(key(yield* studio.snapshot, 0).binding?.label, 'Atomic HTTP');
        assert.strictEqual(key(yield* studio.snapshot, 0).count, 3);
      }).pipe(Effect.provide(Layer.mergeAll(mock.layer(), demoLayer)));
    }),
  ).pipe(Effect.provide(NodeServices.layer), Effect.provide(NodeHttpServer.layerTest)),
);
