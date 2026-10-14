import { assert, it } from '@effect/vitest';
import { NodeCrypto, NodeServices } from '@effect/platform-node';
import { Deferred, Effect, FileSystem, Layer, Ref, Redacted, Schedule } from 'effect';
import { IntegrationError, type Message } from '../src/json-socket.ts';
import { DiscordTransport } from '../src/discord-ipc.ts';
import * as Discord from '../src/plugins/discord.ts';
import * as Plugin from '../src/plugin.ts';
import * as Mock from '../src/mock.ts';
import * as Audio from '../src/audio.ts';
import { startStudio } from '../src/scripts/studio.ts';

const server = Effect.gen(function* () {
  const state = yield* Ref.make({ mute: true, deaf: false });
  const sent: Array<Message> = [];
  let receive: ((frame: Message) => Effect.Effect<void, IntegrationError>) | undefined;
  const failed = yield* Deferred.make<never, IntegrationError>();
  const layer = Layer.succeed(DiscordTransport, {
    connect: (_url, receiver) =>
      Effect.gen(function* () {
        receive = receiver;
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (receive === receiver) receive = undefined;
          }),
        );
        yield* receiver({ evt: 'READY', data: {} });
        return {
          failure: Deferred.await(failed),
          send: (frame: Message) =>
            Effect.gen(function* () {
              sent.push(frame);
              if (frame.cmd === 'SET_VOICE_SETTINGS')
                yield* Ref.update(state, (before) => ({
                  ...before,
                  ...(frame.args as { mute?: boolean; deaf?: boolean }),
                }));
              yield* receiver({
                nonce: frame.nonce,
                cmd: frame.cmd,
                data:
                  frame.cmd === 'GET_VOICE_SETTINGS' || frame.cmd === 'SET_VOICE_SETTINGS'
                    ? yield* Ref.get(state)
                    : {},
              });
            }),
        };
      }),
  });
  const change = (next: Discord.VoiceState) =>
    Ref.set(state, next).pipe(
      Effect.andThen(
        Effect.suspend(
          () =>
            receive?.({ cmd: 'DISPATCH', evt: 'VOICE_SETTINGS_UPDATE', data: next }) ?? Effect.void,
        ),
      ),
    );
  return {
    layer,
    sent,
    change,
    disconnect: Deferred.fail(failed, new IntegrationError({ message: 'Disconnected' })).pipe(
      Effect.asVoid,
    ),
  };
});

it.live(
  'Discord subscribes to voice settings and cached state follows external changes without key presses',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = yield* server;
        const api = yield* Discord.make({
          clientId: 'test',
          accessToken: Redacted.make('test'),
        }).pipe(Effect.provide(fake.layer));
        assert.ok(
          fake.sent.some(
            (frame) => frame.cmd === 'SUBSCRIBE' && frame.evt === 'VOICE_SETTINGS_UPDATE',
          ),
        );
        assert.deepStrictEqual(yield* api.voice, { mute: true, deaf: false });
        yield* fake.change({ mute: false, deaf: true });
        assert.deepStrictEqual(yield* api.voice, { mute: false, deaf: true });
        assert.strictEqual(
          fake.sent.filter((frame) => frame.cmd === 'SET_VOICE_SETTINGS').length,
          0,
        );
        yield* api.toggle('deaf');
        assert.deepStrictEqual(yield* api.voice, { mute: false, deaf: false });
        yield* fake.disconnect;
        assert.strictEqual((yield* Effect.result(api.failure))._tag, 'Failure');
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.live(
  'external RPC events redraw physical/preview feedback; disabled or lost connections show unknown state',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'discord-feedback-' });
        const mock = Mock.make();
        const fake = yield* server;
        const layer = Layer.effect(
          Discord.Discord,
          Discord.make({ clientId: 'test', accessToken: Redacted.make('test') }),
        ).pipe(Layer.provide(fake.layer));
        const plugin = Plugin.fromLayer({
          id: 'discord',
          name: 'Discord test RPC',
          description: 'Simulated RPC, no microphone.',
          controls: {},
          service: Discord.Discord,
          layer,
          actions: Discord.plugin.actions ?? [],
          run: (api) => api.failure,
        });
        yield* Effect.gen(function* () {
          const studio = yield* startStudio({
            profile: `${directory}/profile.json`,
            mock: true,
            applications: [],
            configurePlugins: (host) => host.install(plugin).pipe(Effect.provide(NodeCrypto.layer)),
          });
          yield* studio.actions.save(0, {
            label: 'Mute',
            action: 'plugin',
            parameters: { plugin: 'discord', command: 'mute', input: {} },
          });
          yield* studio.actions.save(1, {
            label: 'Deafen',
            action: 'plugin',
            parameters: { plugin: 'discord', command: 'deafen', input: {} },
          });
          yield* studio.setPlugin({ id: 'discord', enabled: true, expected: false });
          const read = (text: string) =>
            Effect.repeat(studio.snapshot, {
              until: (view) => view.keys[0]!.feedback?.text === text,
              schedule: Schedule.spaced(5),
            });
          const muted = yield* read('COUPÉ');
          assert.strictEqual(muted.keys[0]!.feedback!.icon, 'microphone');
          assert.strictEqual(muted.keys[0]!.feedback!.tone, 'danger');
          const before = mock.writes.filter(
            (write) => write.kind === 'key' && write.index === 0,
          ).length;
          yield* fake.change({ mute: false, deaf: false });
          const active = yield* read('ACTIF');
          assert.strictEqual(active.keys[0]!.feedback!.tone, 'positive');
          assert.ok(
            mock.writes.filter((write) => write.kind === 'key' && write.index === 0).length >
              before,
          );
          const unchanged = mock.writes.length;
          yield* Effect.sleep(550);
          assert.strictEqual(mock.writes.length, unchanged);
          yield* fake.change({ mute: false, deaf: true });
          yield* read('COUPÉ');
          yield* Effect.repeat(studio.snapshot, {
            until: (view) => view.keys[1]!.feedback?.text === 'COUPÉ',
            schedule: Schedule.spaced(5),
          });
          assert.strictEqual(
            fake.sent.filter((frame) => frame.cmd === 'SET_VOICE_SETTINGS').length,
            0,
          );
          yield* studio.setPlugin({ id: 'discord', enabled: false, expected: true });
          const offline = yield* read('HORS LIGNE');
          assert.strictEqual(offline.keys[0]!.feedback!.tone, 'neutral');
          yield* studio.setPlugin({ id: 'discord', enabled: true, expected: false });
          yield* read('COUPÉ');
          yield* fake.disconnect;
          yield* read('HORS LIGNE');
        }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(mock.layer(), Audio.demoLayer)));
      }),
    ).pipe(Effect.provide(NodeServices.layer), Effect.timeout('8 seconds')),
);
