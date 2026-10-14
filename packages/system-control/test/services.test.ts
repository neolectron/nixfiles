import { assert, it } from '@effect/vitest';
import { NodeCrypto } from '@effect/platform-node';
import { Context, Effect, Fiber, Layer, Ref, Redacted, Result, Schedule, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { Audio } from '../src/audio.ts';
import { Spotify } from '../src/spotify.ts';
import { MediaPlayers } from '../src/media.ts';
import { MprisPlayer } from '../src/mpris.ts';
import { Discord } from '../src/discord.ts';
import { audio, input } from './audio-fixture.ts';
import { spotify } from './spotify-fixture.ts';
import { discord } from './discord-fixture.ts';

const spotifyLayer = Spotify.serviceLayer('org.mpris.MediaPlayer2.spotify');
const discordLayer = Discord.serviceLayer(
  Effect.succeed({ clientId: 'test', accessToken: Redacted.make('test') }),
);
const waitReady = (api: Effect.Success<typeof Discord>) =>
  api.voice.pipe(Effect.retry(Schedule.spaced(5)), Effect.timeout('2 seconds'));

it.effect(
  'absolute application volume and mute preserve channels and handle mixed stream mute',
  () => {
    const fake = audio([
      input(1, 'Spotify', [32768, 16384], true),
      input(2, 'Spotify', [32768, 0], false),
    ]);
    return Effect.gen(function* () {
      const api = yield* Audio;
      yield* api.setMuted('spotify', false);
      assert.ok((yield* api.list)[0]?.streams.every((stream) => !stream.muted));
      yield* api.setVolume('spotify', 120);
      const current = (yield* api.state).applications[0];
      assert.ok(current);
      assert.ok(Math.abs(current.volume - 120) < 0.01);
      assert.ok(
        Math.abs(
          (current.streams[0]?.channels[1] ?? 0) / (current.streams[0]?.channels[0] ?? 1) - 0.5,
        ) < 0.001,
      );
      yield* api.setMuted('spotify', true);
      assert.ok((yield* api.list)[0]?.streams.every((stream) => stream.muted));
    }).pipe(Effect.provide(fake.layer));
  },
);

it.effect(
  'absolute commands serialize, enforce caps, and fail for missing targets without mutation',
  () => {
    const fake = audio();
    return Effect.gen(function* () {
      const api = yield* Audio;
      yield* Effect.all([api.setVolume('spotify', 40), api.setVolume('spotify', 65)], {
        concurrency: 'unbounded',
      });
      assert.ok(
        Math.abs(((yield* api.list).find((app) => app.key === 'spotify')?.volume ?? 0) - 65) < 0.01,
      );
      yield* api.setMasterVolume(150);
      yield* api.setMasterMuted(true);
      const master = yield* api.master;
      assert.strictEqual(master?.volume, 150);
      assert.strictEqual(master?.muted, true);
      const count = fake.commands.length;
      for (const operation of [
        api.setVolume('spotify', 201),
        api.setVolume('spotify', Number.NaN),
        api.setMasterVolume(151),
        api.setVolume('missing', 50),
      ]) {
        assert.strictEqual((yield* Effect.result(operation))._tag, 'Failure');
      }
      assert.strictEqual(fake.commands.length, count);
    }).pipe(Effect.provide(fake.layer));
  },
);

it.effect(
  'audio observes external changes automatically and closing its Layer stops polling and stale commands',
  () =>
    Effect.gen(function* () {
      const fake = audio();
      let reads = 0;
      fake.onRead((count) => {
        reads = count;
      });
      const api = yield* Effect.gen(function* () {
        const service = yield* Audio;
        const changed = yield* Stream.runHead(
          service.observe.pipe(
            Stream.filter(
              (value) => Result.isSuccess(value) && value.success.applications.length === 1,
            ),
          ),
        ).pipe(Effect.forkScoped);
        fake.set([input(20, 'Discord', [16384])]);
        yield* TestClock.adjust(500);
        yield* Fiber.join(changed);
        assert.strictEqual((yield* service.state).applications[0]?.key, 'discord');
        return service;
      }).pipe(Effect.scoped, Effect.provide(fake.layer));
      const before = reads;
      yield* TestClock.adjust(2000);
      assert.strictEqual(reads, before);
      assert.strictEqual((yield* Effect.result(api.setMasterMuted(false)))._tag, 'Failure');
      assert.strictEqual((yield* Effect.result(api.state))._tag, 'Failure');
      assert.strictEqual(fake.commands.length, 0);
    }),
);

it.effect(
  'Spotify Layer publishes metadata and command state without a consumer starting a monitor',
  () =>
    Effect.gen(function* () {
      const fake = yield* spotify;
      yield* Effect.gen(function* () {
        const api = yield* Spotify;
        assert.strictEqual((yield* api.state).title, 'Life Will Change');
        const changed = yield* Stream.runHead(
          api.observe.pipe(
            Stream.filter(
              (value) => Result.isSuccess(value) && value.success.title === 'Next track',
            ),
          ),
        ).pipe(Effect.forkScoped);
        yield* fake.change({ title: 'Next track' });
        yield* TestClock.adjust(1000);
        yield* Fiber.join(changed);
        const next = yield* api.command('PlayPause');
        assert.strictEqual(next.status, 'Paused');
        assert.strictEqual((yield* api.state).status, 'Paused');
        assert.strictEqual(fake.requests.filter((args) => args[8] === 'PlayPause').length, 1);
      }).pipe(Effect.scoped, Effect.provide(spotifyLayer.pipe(Layer.provide(fake.layer))));
    }),
);

it.effect(
  'Spotify exposes typed unavailability, recovers in place, and stops work after close',
  () =>
    Effect.gen(function* () {
      const fake = yield* spotify;
      const api = yield* Effect.gen(function* () {
        const service = yield* Spotify;
        yield* Ref.set(fake.mode, 'offline');
        yield* TestClock.adjust(1000);
        assert.strictEqual((yield* service.snapshot)._tag, 'Failure');
        yield* Ref.set(fake.mode, 'online');
        yield* TestClock.adjust(1000);
        assert.strictEqual((yield* service.snapshot)._tag, 'Success');
        return service;
      }).pipe(Effect.provide(spotifyLayer.pipe(Layer.provide(fake.layer))));
      const count = fake.requests.length;
      yield* TestClock.adjust(2000);
      assert.strictEqual((yield* Effect.result(api.command('Play')))._tag, 'Failure');
      assert.strictEqual(fake.requests.length, count);
    }),
);

it.effect(
  'generic MPRIS and global media services work independently of the deck and Spotify adapter',
  () =>
    Effect.gen(function* () {
      const fake = yield* spotify;
      yield* Effect.gen(function* () {
        const player = yield* MprisPlayer;
        const media = yield* MediaPlayers;
        assert.strictEqual((yield* player.state).title, 'Life Will Change');
        assert.strictEqual((yield* media.state).busName, 'org.mpris.MediaPlayer2.spotify');
        yield* media.command('Pause');
        yield* TestClock.adjust(1000);
        assert.strictEqual((yield* player.state).status, 'Paused');
      }).pipe(
        Effect.provide(
          Layer.merge(
            MprisPlayer.serviceLayer('org.mpris.MediaPlayer2.spotify'),
            MediaPlayers.serviceLayer,
          ).pipe(Layer.provide(fake.layer)),
        ),
      );
    }),
);

it.live(
  'Discord Layer observes remote mute and uses idempotent explicit setters, with scoped cleanup',
  () =>
    Effect.gen(function* () {
      const fake = yield* discord;
      const api = yield* Effect.gen(function* () {
        const service = yield* Discord;
        yield* waitReady(service);
        assert.strictEqual(
          fake.sent.filter((frame) => frame.cmd === 'SET_VOICE_SETTINGS').length,
          0,
        );
        const changed = yield* Stream.runHead(
          service.observe.pipe(
            Stream.filter((value) => Result.isSuccess(value) && value.success.deaf),
          ),
        ).pipe(Effect.forkScoped);
        yield* fake.change({ mute: false, deaf: true });
        yield* Fiber.join(changed);
        yield* service.set('mute', false);
        assert.strictEqual(
          fake.sent.filter((frame) => frame.cmd === 'SET_VOICE_SETTINGS').length,
          0,
        );
        yield* service.set('mute', true);
        assert.strictEqual((yield* service.voice).mute, true);
        assert.strictEqual(
          fake.sent.filter((frame) => frame.cmd === 'SET_VOICE_SETTINGS').length,
          1,
        );
        return service;
      }).pipe(
        Effect.scoped,
        Effect.provide(discordLayer.pipe(Layer.provide(fake.layer))),
        Effect.provide(NodeCrypto.layer),
      );
      assert.deepStrictEqual(fake.counts(), { opens: 1, closes: 1 });
      assert.strictEqual((yield* Effect.result(api.toggle('mute')))._tag, 'Failure');
      assert.strictEqual(fake.sent.filter((frame) => frame.cmd === 'SET_VOICE_SETTINGS').length, 1);
    }),
);

it.live('Discord reconnects with the same API and releases each failed socket', () =>
  Effect.gen(function* () {
    const fake = yield* discord;
    yield* Effect.gen(function* () {
      const api = yield* Discord;
      yield* waitReady(api);
      yield* fake.disconnect;
      yield* api.voice.pipe(
        Effect.result,
        Effect.repeat({ until: Result.isFailure, schedule: Schedule.spaced(5) }),
        Effect.timeout('2 seconds'),
      );
      assert.strictEqual((yield* api.snapshot)._tag, 'Failure');
      yield* waitReady(api);
      assert.deepStrictEqual(fake.counts(), { opens: 2, closes: 1 });
      yield* api.set('deaf', true);
      assert.strictEqual((yield* api.state).deaf, true);
    }).pipe(
      Effect.provide(discordLayer.pipe(Layer.provide(fake.layer))),
      Effect.provide(NodeCrypto.layer),
    );
    assert.deepStrictEqual(fake.counts(), { opens: 2, closes: 2 });
  }),
);

it.live('multiple Layer consumers share one system instance and one Discord connection', () =>
  Effect.gen(function* () {
    const fake = yield* discord;
    const services = discordLayer.pipe(Layer.provide(fake.layer));
    let first: Effect.Success<typeof Discord> | undefined;
    let second: Effect.Success<typeof Discord> | undefined;
    const consumerA = Layer.effectContext(
      Effect.map(Discord, (api) => {
        first = api;
        return Context.empty();
      }),
    );
    const consumerB = Layer.effectContext(
      Effect.map(Discord, (api) => {
        second = api;
        return Context.empty();
      }),
    );
    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* Layer.build(
          Layer.merge(
            consumerA.pipe(Layer.provide(services)),
            consumerB.pipe(Layer.provide(services)),
          ),
        );
        assert.ok(first);
        assert.strictEqual(first, second);
        yield* waitReady(first);
        assert.deepStrictEqual(fake.counts(), { opens: 1, closes: 0 });
      }),
    ).pipe(Effect.provide(NodeCrypto.layer));
    assert.deepStrictEqual(fake.counts(), { opens: 1, closes: 1 });
  }),
);
