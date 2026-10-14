import { assert, it } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import { Config, Effect, Fiber, FileSystem, Layer, Schedule, Stream } from 'effect';
import * as Mock from '../src/mock.ts';
import * as Actions from '../src/studio-actions.tsx';
import { StreamDeck } from '../src/stream-deck.ts';
import { demoLayer } from '@nixfiles/system-control/audio.ts';
import { startStudio } from '../src/scripts/studio.ts';

it.live(
  'legacy profiles migrate on the first write with an exact backup and preserve shortcuts',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-migrate-' });
        const file = `${directory}/profile.json`;
        const text = JSON.stringify({
          version: 1,
          buttons: { '5': { label: 'Original', action: 'counter', parameters: { start: 12 } } },
        });
        yield* fs.writeFileString(file, text);
        const mock = Mock.make();
        yield* Effect.gen(function* () {
          const actions = yield* Actions.make(yield* StreamDeck, file, []);
          assert.strictEqual(yield* fs.readFileString(file), text);
          const initial = yield* actions.view;
          assert.strictEqual(initial.keys.get(5)!.state.count, 12);
          yield* actions.organize({
            operation: 'create-folder',
            key: 6,
            name: 'Outils',
            address: initial.keys.get(6)!.address,
          });
          assert.strictEqual(yield* fs.readFileString(`${file}.v1.backup`), text);
          const saved = JSON.parse(yield* fs.readFileString(file));
          assert.strictEqual(saved.version, 2);
          assert.strictEqual(saved.zones[0].items[5].binding.label, 'Original');
          yield* actions.press(5);
          assert.strictEqual((yield* actions.states).get(5)!.count, 13);
        }).pipe(Effect.provide(mock.layer()));
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.live(
  'nested folders retain shortcut identity and state, offer return on every page, and reject cycles',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-folder-' });
        const file = `${directory}/profile.json`;
        const mock = Mock.make();
        yield* Effect.gen(function* () {
          const actions = yield* Actions.make(yield* StreamDeck, file, []);
          yield* actions.save(0, {
            label: 'Compteur',
            action: 'counter',
            parameters: { start: 7 },
          });
          const original = (yield* actions.view).keys.get(0)!.entry!;
          yield* actions.organize({
            operation: 'create-folder',
            key: 2,
            name: 'Outils',
            address: (yield* actions.view).keys.get(2)!.address,
          });
          const folder = (yield* actions.profile).folders[0]!;
          yield* actions.organize({
            operation: 'move',
            id: original.id,
            destination: `folder:${folder.id}`,
            revision: (yield* actions.view).layout.revision,
          });
          yield* actions.press(2);
          assert.strictEqual((yield* actions.view).keys.get(0)!.virtual, true);
          assert.strictEqual((yield* actions.view).keys.get(1)!.entry!.id, original.id);
          yield* actions.press(1);
          assert.strictEqual((yield* actions.states).get(1)!.count, 8);
          yield* actions.organize({
            operation: 'create-folder',
            key: 2,
            name: 'Sous-dossier',
            address: (yield* actions.view).keys.get(2)!.address,
          });
          const child = (yield* actions.profile).folders[1]!;
          yield* actions.organize({
            operation: 'move',
            id: original.id,
            destination: `folder:${child.id}`,
            revision: (yield* actions.view).layout.revision,
          });
          yield* actions.press(2);
          assert.strictEqual((yield* actions.view).layout.zones[0]!.breadcrumbs.length, 2);
          assert.strictEqual((yield* actions.states).get(1)!.count, 8);
          yield* actions.organize({
            operation: 'add-page',
            zone: 'deck',
            revision: (yield* actions.view).layout.revision,
          });
          assert.strictEqual((yield* actions.view).keys.get(0)!.entry!.binding.action, 'go-back');
          yield* actions.press(0);
          assert.strictEqual((yield* actions.view).layout.zones[0]!.folder, folder.id);
          yield* actions.press(0);
          assert.strictEqual((yield* actions.view).layout.zones[0]!.folder, null);
          const parentEntry = (yield* actions.view).keys.get(2)!.entry!;
          const before = yield* fs.readFileString(file);
          const cycle = yield* Effect.result(
            actions.organize({
              operation: 'move',
              id: parentEntry.id,
              destination: `folder:${child.id}`,
              revision: (yield* actions.view).layout.revision,
            }),
          );
          assert.strictEqual(cycle._tag, 'Failure');
          assert.strictEqual(yield* fs.readFileString(file), before);
        }).pipe(Effect.provide(mock.layer()));
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.live('zones preserve all pages and pinned pagination changes only its selected target', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-zone-' });
      const mock = Mock.make();
      yield* Effect.gen(function* () {
        const actions = yield* Actions.make(yield* StreamDeck, `${directory}/profile.json`, []);
        const counter = (start: number) => ({
          label: `${start}`,
          action: 'counter',
          parameters: { start },
        });
        yield* actions.save(0, counter(11));
        yield* actions.save(2, counter(33));
        yield* actions.organize({
          operation: 'add-page',
          zone: 'deck',
          revision: (yield* actions.view).layout.revision,
        });
        yield* actions.save(0, counter(22));
        yield* actions.navigate({ zone: 'deck', operation: 'root' });
        yield* actions.organize({
          operation: 'create-zone',
          name: 'Apps',
          keys: [0, 1],
          revision: (yield* actions.view).layout.revision,
        });
        const zone = (yield* actions.profile).zones[1]!;
        assert.strictEqual((yield* actions.states).get(0)!.count, 11);
        assert.strictEqual((yield* actions.states).get(2)!.count, 33);
        yield* actions.save(35, {
          label: 'Suivant',
          action: 'page-next',
          parameters: { target: zone.id },
        });
        const tile = (yield* actions.view).keys.get(35)!;
        yield* actions.organize({ operation: 'pin', key: 35, value: true, address: tile.address });
        yield* actions.press(35);
        assert.strictEqual((yield* actions.states).get(0)!.count, 22);
        assert.strictEqual((yield* actions.view).layout.zones[0]!.page, 0);
        assert.strictEqual((yield* actions.states).get(2)!.count, 33);
        const pinned = (yield* actions.view).keys.get(35)!.entry!.id;
        yield* actions.navigate({ zone: 'deck', operation: 'next' });
        assert.strictEqual((yield* actions.view).keys.get(35)!.entry!.id, pinned);
        yield* actions.press(35);
        assert.strictEqual((yield* actions.states).get(0)!.count, 11);
        const old = (yield* actions.view).keys.get(1)!.address;
        yield* actions.navigate({ zone: zone.id, operation: 'next' });
        assert.strictEqual(
          (yield* Effect.result(actions.save(1, counter(99), null, old)))._tag,
          'Failure',
        );
        assert.strictEqual((yield* Effect.result(actions.press(1, old)))._tag, 'Failure');
        assert.strictEqual(
          (yield* Effect.result(
            actions.organize({
              operation: 'create-zone',
              name: 'Overlap',
              keys: [0],
              revision: (yield* actions.view).layout.revision,
            }),
          ))._tag,
          'Failure',
        );
      }).pipe(Effect.provide(mock.layer()));
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.live('physical pagination buttons page only the LCD mixer and keep Master pinned', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-audio-page-' });
      const mock = Mock.make();
      yield* Effect.gen(function* () {
        const studio = yield* startStudio({
          profile: `${directory}/profile.json`,
          applications: [],
          mock: true,
        });
        yield* studio.actions.save(0, {
          label: 'Audio suivant',
          action: 'page-next',
          parameters: { target: 'audio' },
        });
        const before = yield* studio.snapshot;
        const views = yield* Stream.toPull(studio.inputViews);
        const fiber = yield* Effect.forkScoped(studio.run);
        yield* mock.emit({ _tag: 'KeyDown', key: 0 });
        yield* views;
        const after = yield* Effect.repeat(studio.snapshot, {
          until: (snapshot) => snapshot.page === 1,
          schedule: Schedule.spaced(1),
        });
        assert.strictEqual(after.layout.zones[0]!.page, 0);
        assert.notStrictEqual(after.dials[0]!.name, before.dials[0]!.name);
        assert.strictEqual(after.dials.at(-1)!.volume, before.dials.at(-1)!.volume);
        yield* Fiber.interrupt(fiber);
      }).pipe(Effect.provide(Layer.mergeAll(mock.layer(), demoLayer)));
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.live('a command completing on a hidden page cannot overwrite its replacement key', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const node = yield* Config.String('npm_node_execpath');
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-hidden-' });
      const mock = Mock.make();
      yield* Effect.gen(function* () {
        const actions = yield* Actions.make(yield* StreamDeck, `${directory}/profile.json`, []);
        yield* actions.save(0, {
          label: 'Commande',
          action: 'run-command',
          parameters: {
            executable: node,
            arguments: ['-e', 'setTimeout(() => { console.log("done") }, 150)'],
            directory: '',
          },
        });
        const id = (yield* actions.view).keys.get(0)!.entry!.id;
        yield* actions.press(0);
        yield* actions.organize({
          operation: 'add-page',
          zone: 'deck',
          revision: (yield* actions.view).layout.revision,
        });
        yield* actions.save(0, {
          label: 'Remplacement',
          action: 'counter',
          parameters: { start: 42 },
        });
        const writes = mock.writes.length;
        yield* Effect.repeat(actions.entryStates, {
          until: (states) => states.get(id)?.status === 'success',
          schedule: Schedule.spaced(10),
        });
        assert.strictEqual((yield* actions.states).get(0)!.count, 42);
        assert.strictEqual(mock.writes.length, writes);
        yield* actions.navigate({ zone: 'deck', operation: 'previous' });
        assert.strictEqual((yield* actions.states).get(0)!.status, 'success');
        assert.strictEqual((yield* actions.states).get(0)!.detail.trim(), 'done');
      }).pipe(Effect.provide(mock.layer()));
    }),
  ).pipe(Effect.provide(NodeServices.layer), Effect.timeout('5 seconds')),
);

it.live(
  'pinning a shortcut does not create an empty page and manually added pages remain available',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-pin-pages-' });
        const mock = Mock.make();
        yield* Effect.gen(function* () {
          const actions = yield* Actions.make(yield* StreamDeck, `${directory}/profile.json`, []);
          yield* actions.save(0, {
            label: 'Suivant',
            action: 'page-next',
            parameters: { target: 'current' },
          });
          yield* actions.organize({
            operation: 'pin',
            key: 0,
            value: true,
            address: (yield* actions.view).keys.get(0)!.address,
          });
          assert.strictEqual((yield* actions.view).layout.zones[0]!.pages, 1);
          yield* actions.organize({
            operation: 'add-page',
            zone: 'deck',
            revision: (yield* actions.view).layout.revision,
          });
          assert.strictEqual((yield* actions.view).layout.zones[0]!.page, 1);
          assert.strictEqual((yield* actions.view).layout.zones[0]!.pages, 2);
          yield* actions.press(0);
          assert.strictEqual((yield* actions.view).layout.zones[0]!.page, 0);
        }).pipe(Effect.provide(mock.layer()));
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.live('a two-key folder zone cannot pin away its content slot or lose Return after reload', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-folder-capacity-' });
      const file = `${directory}/profile.json`;
      const mock = Mock.make();
      const stored = JSON.stringify({
        version: 2,
        zones: [
          {
            id: 'deck',
            name: 'Main',
            keys: Array.from({ length: 34 }, (_, i) => i + 2),
            items: [],
            pinned: {},
          },
          {
            id: 'tools',
            name: 'Tools',
            keys: [0, 1],
            items: [
              {
                id: 'folder-link',
                binding: {
                  label: 'Tools',
                  action: 'open-folder',
                  parameters: { folder: 'folder' },
                },
              },
            ],
            pinned: {},
          },
        ],
        folders: [{ id: 'folder', name: 'Tools', items: [] }],
      });
      yield* fs.writeFileString(file, stored);
      yield* Effect.gen(function* () {
        const actions = yield* Actions.make(yield* StreamDeck, file, []);
        assert.ok(
          mock.writes.some(
            (write) =>
              write.kind === 'key' &&
              write.index === 1 &&
              write.image.data.every((value) => value === 0),
          ),
        );
        const result = yield* Effect.result(
          actions.organize({
            operation: 'pin',
            key: 0,
            value: true,
            address: (yield* actions.view).keys.get(0)!.address,
          }),
        );
        assert.strictEqual(result._tag, 'Failure');
        assert.strictEqual(yield* fs.readFileString(file), stored);
        yield* actions.press(0);
        assert.strictEqual((yield* actions.view).keys.get(0)!.virtual, true);
        yield* actions.press(0);
        assert.strictEqual((yield* actions.view).layout.zones[1]!.folder, null);
      }).pipe(Effect.provide(mock.layer()));
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.live('a folder can open a different zone while its own single-key zone stays in place', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-folder-target-' });
      const file = `${directory}/profile.json`;
      const mock = Mock.make();
      yield* Effect.gen(function* () {
        const actions = yield* Actions.make(yield* StreamDeck, file, []);
        yield* actions.organize({
          operation: 'create-zone',
          name: 'Contenu',
          keys: [0, 1, 2],
          revision: (yield* actions.view).layout.revision,
        });
        const content = (yield* actions.profile).zones[1]!;
        yield* actions.organize({
          operation: 'create-zone',
          name: 'Navigation',
          keys: [35],
          revision: (yield* actions.view).layout.revision,
        });
        yield* actions.organize({
          operation: 'create-folder',
          key: 35,
          name: 'Outils',
          target: content.id,
          address: (yield* actions.view).keys.get(35)!.address,
        });
        const button = (yield* actions.view).keys.get(35)!.entry!.id;
        yield* actions.press(35);
        assert.strictEqual(
          (yield* actions.view).layout.zones.find((zone) => zone.id === content.id)!.folder,
          (yield* actions.profile).folders[0]!.id,
        );
        assert.strictEqual((yield* actions.view).keys.get(0)!.virtual, true);
        assert.strictEqual((yield* actions.view).keys.get(35)!.entry!.id, button);
        assert.strictEqual((yield* actions.view).layout.zones.at(-1)!.folder, null);
        const before = yield* fs.readFileString(file);
        assert.strictEqual(
          (yield* Effect.result(
            actions.save(35, {
              label: 'Invalid',
              action: 'open-folder',
              parameters: { folder: (yield* actions.profile).folders[0]!.id, target: 'audio' },
            }),
          ))._tag,
          'Failure',
        );
        assert.strictEqual(
          (yield* Effect.result(
            actions.organize({
              operation: 'resize-zone',
              zone: content.id,
              keys: [0],
              revision: (yield* actions.view).layout.revision,
            }),
          ))._tag,
          'Failure',
        );
        assert.strictEqual(yield* fs.readFileString(file), before);
        yield* actions.press(0);
        assert.strictEqual(
          (yield* actions.view).layout.zones.find((zone) => zone.id === content.id)!.folder,
          null,
        );
      }).pipe(Effect.provide(mock.layer()));
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.live(
  'resizing a zone exchanges root slots on every page and preserves fixed controls and stable state',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-zone-resize-' });
        const mock = Mock.make();
        yield* Effect.gen(function* () {
          const actions = yield* Actions.make(yield* StreamDeck, `${directory}/profile.json`, []);
          const counter = (start: number) => ({
            label: `${start}`,
            action: 'counter',
            parameters: { start },
          });
          yield* actions.save(35, counter(0));
          yield* actions.organize({
            operation: 'pin',
            key: 35,
            value: true,
            address: (yield* actions.view).keys.get(35)!.address,
          });
          yield* actions.save(2, counter(10));
          const movedId = (yield* actions.view).keys.get(2)!.entry!.id;
          yield* actions.press(2);
          yield* actions.organize({
            operation: 'add-page',
            zone: 'deck',
            revision: (yield* actions.view).layout.revision,
          });
          yield* actions.save(2, counter(20));
          yield* actions.save(4, counter(40));
          yield* actions.navigate({ zone: 'deck', operation: 'root' });
          yield* actions.organize({
            operation: 'create-zone',
            name: 'Apps',
            keys: [0, 1, 2],
            revision: (yield* actions.view).layout.revision,
          });
          const zone = (yield* actions.profile).zones[1]!;
          yield* actions.save(35, {
            label: 'Next',
            action: 'page-next',
            parameters: { target: zone.id },
          });
          const fixedId = (yield* actions.view).keys.get(35)!.entry!.id;
          yield* actions.organize({
            operation: 'resize-zone',
            zone: zone.id,
            keys: [0, 1, 4],
            revision: (yield* actions.view).layout.revision,
          });
          assert.strictEqual((yield* actions.view).keys.get(2)!.zone, 'deck');
          assert.strictEqual((yield* actions.view).keys.get(2)!.entry!.id, movedId);
          assert.strictEqual((yield* actions.states).get(2)!.count, 11);
          yield* actions.navigate({ zone: 'deck', operation: 'next' });
          assert.strictEqual((yield* actions.states).get(2)!.count, 20);
          yield* actions.press(35);
          assert.strictEqual((yield* actions.states).get(4)!.count, 40);
          assert.strictEqual((yield* actions.view).keys.get(35)!.entry!.id, fixedId);
          const before = yield* actions.profile;
          assert.strictEqual(
            (yield* Effect.result(
              actions.organize({
                operation: 'resize-zone',
                zone: zone.id,
                keys: [0, 35],
                revision: (yield* actions.view).layout.revision,
              }),
            ))._tag,
            'Failure',
          );
          assert.deepStrictEqual(yield* actions.profile, before);
        }).pipe(Effect.provide(mock.layer()));
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);
