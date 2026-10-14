import { assert, it } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import { ConfigProvider, Effect, FileSystem, Layer } from 'effect';
import * as Discord from '../src/plugins/discord.ts';
import { DiscordTransport } from '../src/discord-ipc.ts';
import { DiscordOAuth } from '../src/discord-connection.ts';
import { DesktopKeys } from '../src/desktop-keys.ts';
import type { Message } from '../src/json-socket.ts';
import * as Mock from '../src/mock.ts';
import * as Audio from '../src/audio.ts';
import * as Actions from '../src/studio-actions.tsx';
import * as Settings from '../src/plugin-settings.ts';
import * as Layout from '../src/studio-layout.ts';
import { StreamDeck } from '../src/stream-deck.ts';
import { startStudio } from '../src/scripts/studio.ts';
import type { Entry, Profile } from '../src/studio-contract.ts';

const fakeRPC = Layer.succeed(DiscordTransport, {
  connect: (_id, receive) =>
    Effect.gen(function* () {
      yield* receive({ evt: 'READY' });
      return {
        failure: Effect.never,
        send: (frame: Message) =>
          receive({ nonce: frame.nonce, data: { mute: true, deaf: false } }),
      };
    }),
});
const configured = (environment: Record<string, string>) =>
  Discord.configured.pipe(
    Effect.provide(Layer.mergeAll(fakeRPC, DiscordOAuth.layer, DesktopKeys.layer)),
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromEnvRecord({
        STREAMDECK_DISCORD_CLIENT_ID: '123456',
        STREAMDECK_DISCORD_ACCESS_TOKEN: 'test-token',
        ...environment,
      }),
    ),
  );

it.live(
  'Discord activation works without a share bridge and never starts configured sharing automatically',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'discord-unified-' });
        const marker = `${directory}/share-ran`;
        const absent = yield* configured({});
        assert.deepStrictEqual(yield* absent.current, { mute: true, deaf: false });
        assert.strictEqual((yield* Effect.result(absent.shareScreen))._tag, 'Failure');
        const api = yield* configured({
          STREAMDECK_DISCORD_SCREEN_SHARE: JSON.stringify(['touch', marker]),
        });
        assert.strictEqual(yield* fs.exists(marker), false);
        const action = Discord.plugin.actions!.find((action) => action.info.id === 'share-screen')!;
        yield* action
          .execute(api, {}, { output: () => Effect.void })
          .pipe(Effect.provide(Mock.make().layer()));
        assert.strictEqual(yield* fs.exists(marker), true);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.live(
  'legacy sharing shortcuts in pages, pinned keys and folders retain identity and persist on the next write',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'discord-profile-' });
        const file = `${directory}/profile.json`;
        const mock = Mock.make();
        yield* Effect.gen(function* () {
          const deck = yield* StreamDeck;
          const old = (id: string): Entry => ({
            id,
            binding: {
              label: id,
              action: 'plugin',
              parameters: { plugin: 'discord-screen-share', command: 'share-screen', input: {} },
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
                pinned: { '2': old('pinned') },
                items: [old('page'), null],
              },
            ],
            folders: [{ id: 'tools', name: 'Tools', minimumPages: 3, items: [old('folder')] }],
          };
          const text = JSON.stringify(profile);
          yield* fs.writeFileString(file, text);
          const actions = yield* Actions.make(deck, file, []);
          const migrated = yield* actions.profile;
          assert.deepStrictEqual(
            Layout.entries(migrated).map((entry) => entry.id),
            ['page', 'pinned', 'folder'],
          );
          for (const entry of Layout.entries(migrated)) {
            assert.strictEqual(entry.binding.action, 'plugin');
            if (entry.binding.action === 'plugin')
              assert.strictEqual(entry.binding.parameters.plugin, 'discord');
          }
          assert.strictEqual(migrated.zones[0]!.minimumPages, 2);
          assert.strictEqual(migrated.folders[0]!.minimumPages, 3);
          assert.strictEqual(yield* fs.readFileString(file), text);
          yield* actions.save(1, { label: 'Keep', action: 'counter', parameters: { start: 7 } });
          assert.strictEqual(yield* fs.readFileString(`${file}.discord-share.backup`), text);
          assert.ok(!(yield* fs.readFileString(file)).includes('discord-screen-share'));
        }).pipe(Effect.provide(mock.layer()));
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.live(
  'merged activation preferences preserve unrelated plugins and disabling stays disabled after restart',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'discord-settings-' });
        const file = `${directory}/plugins.json`;
        yield* fs.writeFileString(
          file,
          JSON.stringify({
            version: 1,
            enabled: { discord: false, 'discord-screen-share': true, other: true },
          }),
        );
        const settings = yield* Settings.make(file);
        assert.deepStrictEqual(settings.initial, { discord: true, other: true });
        const disable = settings.save('discord', false);
        const extra = settings.save('another', true);
        yield* disable;
        yield* extra;
        assert.deepStrictEqual((yield* Settings.make(file)).initial, {
          discord: false,
          other: true,
          another: true,
        });
        assert.strictEqual((yield* fs.stat(file)).mode & 0o777, 0o600);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.live(
  'the studio exposes one Discord feature and all voice/sharing actions under its single ID',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'discord-catalogue-' });
        const mock = Mock.make();
        yield* Effect.gen(function* () {
          const studio = yield* startStudio({
            profile: `${directory}/profile.json`,
            applications: [],
            mock: true,
          });
          assert.deepStrictEqual(
            (yield* studio.snapshot).plugins.items
              .filter((plugin) => plugin.id.startsWith('discord'))
              .map((plugin) => plugin.id),
            ['discord'],
          );
          assert.deepStrictEqual(
            (yield* studio.plugins.catalogue)
              .filter((action) => action.plugin === 'discord')
              .map((action) => action.id),
            ['status', 'mute', 'deafen', 'share-screen'],
          );
        }).pipe(Effect.provide(Layer.mergeAll(mock.layer(), Audio.demoLayer)));
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);
