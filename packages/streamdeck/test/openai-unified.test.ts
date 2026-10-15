import { assert, it } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import { ConfigProvider, Effect, FileSystem, Layer, Result } from 'effect';
import * as Audio from '@nixfiles/system-control/audio.ts';
import * as Desktop from '@nixfiles/system-control/desktop.ts';
import * as Mock from '../src/mock.ts';
import * as Actions from '../src/studio-actions.tsx';
import * as Settings from '../src/plugin-settings.ts';
import * as Layout from '../src/studio-layout.ts';
import * as OpenAI from '../src/plugins/openai-apps.ts';
import * as Host from '../src/plugin-host.ts';
import { StreamDeck } from '../src/stream-deck.ts';
import { startStudio } from '../src/scripts/studio.ts';
import type { Entry, Profile } from '../src/studio-contract.ts';

it.live(
  'old voice bindings retain their identity and gestures, with a backup on the next save',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: 'openai-profile-' });
        const file = `${dir}/profile.json`;
        yield* Effect.gen(function* () {
          const deck = yield* StreamDeck;
          const entry = (id: string): Entry => ({
            id,
            binding: {
              label: id,
              action: 'plugin',
              trigger: { type: 'long-press', milliseconds: 500 },
              parameters: { plugin: 'dot-voice', command: 'talk', input: {} },
            },
          });
          const profile: Profile = {
            version: 2,
            zones: [
              {
                id: 'deck',
                name: 'Deck',
                keys: deck.buttons.map((key) => key.index),
                minimumPages: 2,
                pinned: { '2': entry('pinned') },
                items: [entry('page'), null],
              },
            ],
            folders: [{ id: 'tools', name: 'Tools', minimumPages: 3, items: [entry('folder')] }],
          };
          const original = JSON.stringify(profile);
          yield* fs.writeFileString(file, original);
          const actions = yield* Actions.make(deck, file, []);
          const migrated = yield* actions.profile;
          assert.deepStrictEqual(
            Layout.entries(migrated),
            Layout.entries(profile).map((before) => ({
              ...before,
              binding: {
                ...before.binding,
                action: 'plugin' as const,
                parameters: { plugin: 'openai-apps', command: 'talk', input: {} },
              },
            })),
          );
          assert.strictEqual(migrated.zones[0]!.minimumPages, 2);
          assert.strictEqual(migrated.folders[0]!.minimumPages, 3);
          assert.strictEqual(yield* fs.readFileString(file), original);
          yield* actions.save(1, { label: 'Keep', action: 'counter', parameters: { start: 7 } });
          assert.strictEqual(yield* fs.readFileString(`${file}.dot-voice.backup`), original);
          assert.notInclude(yield* fs.readFileString(file), 'dot-voice');
        }).pipe(Effect.provide(Mock.make().layer()));
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.live(
  'voice activation merges once into OpenAI preferences and stays disabled after a restart',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: 'openai-preferences-' });
        const file = `${dir}/plugins.json`;
        yield* fs.writeFileString(
          file,
          JSON.stringify({
            version: 1,
            enabled: {
              'dot-voice': true,
              'openai-apps': false,
              spotify: true,
            },
          }),
        );
        const settings = yield* Settings.make(file);
        assert.deepStrictEqual(settings.initial, { 'openai-apps': true, spotify: true });
        yield* settings.save('openai-apps', false);
        assert.deepStrictEqual((yield* Settings.make(file)).initial, {
          'openai-apps': false,
          spotify: true,
        });
        assert.notInclude(yield* fs.readFileString(file), 'dot-voice');
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.live(
  'studio registers only OpenAI voice actions and missing bridges do not prevent activation',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: 'openai-unified-' });
        const desktop = yield* Desktop.make.pipe(
          Effect.provideService(Desktop.DesktopBackend, {
            applications: Effect.succeed([]),
            windows: Effect.succeed([]),
            launch: () => Effect.die('Unexpected application launch'),
            focus: () => Effect.die('Unexpected focus change'),
          }),
        );
        yield* Effect.gen(function* () {
          const studio = yield* startStudio({
            profile: `${dir}/profile.json`,
            applications: [],
            mock: true,
          });
          assert.strictEqual(
            (yield* studio.snapshot).plugins.items.some((plugin) => plugin.id === 'dot-voice'),
            false,
          );
          const talk = (yield* studio.plugins.catalogue).find(
            (action) => action.plugin === 'openai-apps' && action.id === 'talk',
          );
          assert.strictEqual(talk?.interaction, 'hold');
          assert.strictEqual(talk?.tile?.icon, 'microphone');
          assert.deepStrictEqual(talk?.tile?.surfaces, ['key']);
          // Installation and activation never execute configured microphone commands.
          const host = yield* Host.make;
          yield* host.install(OpenAI.plugin).pipe(Effect.provide(NodeServices.layer));
          yield* host.setEnabled('openai-apps', true);
          assert.strictEqual(
            (yield* host.feedback('openai-apps', 'talk', {}))?.text,
            'À CONNECTER',
          );
          assert.ok(
            Result.isFailure(
              yield* Effect.result(
                host.invoke(
                  'openai-apps',
                  'talk',
                  {},
                  {
                    released: Effect.void,
                    output: () => Effect.void,
                  },
                ),
              ),
            ),
          );
          assert.strictEqual((yield* host.snapshot).items[0]?.phase, 'enabled');
        }).pipe(
          Effect.provide(Layer.mergeAll(Mock.make().layer(), Audio.demoLayer)),
          Effect.provideService(Desktop.Desktop, desktop),
        );
      }),
    ).pipe(
      Effect.provide(NodeServices.layer),
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnvRecord({})),
    ),
);
