import { assert, it } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Layer, Ref, Schedule } from 'effect';
import * as Media from '../src/media.ts';
import * as Mpris from '../src/mpris.ts';
import * as MediaPlugin from '../src/plugins/media.ts';
import * as Plugin from '../src/plugin.ts';
import * as Audio from '../src/audio.ts';
import * as Mock from '../src/mock.ts';
import { IntegrationError } from '../src/json-socket.ts';
import { startStudio } from '../src/scripts/studio.ts';

interface Player { readonly name: string; readonly status: Mpris.State['status']; readonly controllable?: boolean; readonly next?: boolean }
const spotify = 'org.mpris.MediaPlayer2.spotify'; const browser = 'org.mpris.MediaPlayer2.chromium.instance1';
const fake = (initial: ReadonlyMap<string, Player>) => Effect.gen(function*() {
  const players = yield* Ref.make(initial); const requests: ReadonlyArray<string>[] = [];
  const layer = Layer.succeed(Mpris.MprisTransport, { ready: Effect.void, run: (args) => Effect.gen(function*() {
    requests.push(args); assert.deepStrictEqual(args.slice(0, 4), ['--user', '--json=short', '--timeout=2s', '--auto-start=no']);
    const all = yield* Ref.get(players);
    if (args[4] === 'list') return JSON.stringify([...all].map(([name, player]) => ({ name, process: player.name })));
    const player = all.get(args[5]!); if (!player) return yield* Effect.fail(new IntegrationError({ message: 'Lecteur fermé' }));
    if (args[8] === 'GetAll') {
      const bool = (data: boolean) => ({ type: 'b', data });
      return JSON.stringify({ type: 'a{sv}', data: [{ PlaybackStatus: { type: 's', data: player.status }, CanControl: bool(player.controllable ?? true),
        CanGoNext: bool(player.next ?? true), CanGoPrevious: bool(true), CanPlay: bool(true), CanPause: bool(true), CanSeek: bool(true) }] });
    }
    assert.strictEqual(args[7], 'org.mpris.MediaPlayer2.Player');
    const method = args[8];
    const status = method === 'PlayPause' ? player.status === 'Playing' ? 'Paused' : 'Playing' : method === 'Play' ? 'Playing' : method === 'Pause' ? 'Paused' : method === 'Stop' ? 'Stopped' : player.status;
    yield* Ref.update(players, (before) => new Map([...before, [args[5]!, { ...player, status }]]));
    return '';
  }) });
  return { layer, players, requests, commands: () => requests.filter((args) => args[4] !== 'list' && args[8] !== 'GetAll') };
});

it.live('global commands select one playing player, retain it on pause and switch when another starts', () => Effect.gen(function*() {
  const server = yield* fake(new Map([[browser, { name: 'Chrome', status: 'Paused' }], [spotify, { name: 'Spotify', status: 'Playing' }]]));
  const api = yield* Media.make.pipe(Effect.provide(server.layer));
  assert.strictEqual((yield* api.state).busName, spotify); assert.strictEqual(server.commands().length, 0);
  yield* api.command('PlayPause'); assert.strictEqual((yield* api.current).busName, spotify);
  yield* Ref.update(server.players, (all) => new Map([...all, [browser, { name: 'Chrome', status: 'Playing' }]]));
  assert.strictEqual((yield* api.current).busName, browser); yield* api.command('Next'); yield* api.command('Previous');
  assert.deepStrictEqual(server.commands().map((args) => [args[5], args[8]]), [[spotify, 'PlayPause'], [browser, 'Next'], [browser, 'Previous']]);
}));

it.live('new players and closed players are rediscovered without launching them or broadcasting commands', () => Effect.gen(function*() {
  const server = yield* fake(new Map([[browser, { name: 'Chrome', status: 'Playing' }]]));
  const api = yield* Media.make.pipe(Effect.provide(server.layer));
  yield* Ref.update(server.players, (all) => new Map([...all, [spotify, { name: 'Spotify', status: 'Playing' }]]));
  assert.strictEqual((yield* api.current).busName, spotify);
  yield* Ref.update(server.players, (all) => new Map([...all].filter(([name]) => name !== spotify)));
  yield* api.command('Pause'); assert.deepStrictEqual(server.commands().map((args) => [args[5], args[8]]), [[browser, 'Pause']]);
}));

it.live('offline and unsupported media never send a mutation and a newly opened player recovers', () => Effect.gen(function*() {
  const server = yield* fake(new Map()); const api = yield* Media.make.pipe(Effect.provide(server.layer));
  assert.strictEqual((yield* Effect.result(api.command('Next')))._tag, 'Failure');
  yield* Ref.set(server.players, new Map([[spotify, { name: 'Spotify', status: 'Playing', next: false }]]));
  assert.strictEqual((yield* api.current).busName, spotify);
  assert.strictEqual((yield* Effect.result(api.command('Next')))._tag, 'Failure'); assert.strictEqual(server.commands().length, 0);
  yield* Ref.set(server.players, new Map([[browser, { name: 'Chrome', status: 'Stopped' }], [spotify, { name: 'Spotify', status: 'Paused' }]]));
  assert.strictEqual((yield* api.current).busName, spotify);
  yield* api.command('Play'); assert.strictEqual((yield* api.state).playback.status, 'Playing');
}));

it.live('media plugin exposes standard actions, live target feedback and stops polling on disable', () => Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem; const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'media-plugin-' });
  const mock = Mock.make(); const server = yield* fake(new Map([[spotify, { name: 'Spotify', status: 'Playing' }]]));
  const layer = Layer.effect(MediaPlugin.MediaKeys, Media.make.pipe(Effect.provide(server.layer)));
  const plugin = Plugin.fromLayer({ ...MediaPlugin.plugin, service: MediaPlugin.MediaKeys, layer, run: (api) => api.monitor });
  yield* Effect.scoped(Effect.gen(function*() {
    const studio = yield* startStudio({ profile: `${directory}/profile.json`, applications: [], mock: true, configurePlugins: (host) => host.install(plugin) });
    yield* studio.actions.save(0, { label: 'Média lecture / pause', action: 'plugin', parameters: { plugin: 'media', command: 'play-pause', input: {} } });
    yield* studio.setPlugin({ id: 'media', enabled: true, expected: false });
    const snapshot = yield* Effect.repeat(studio.snapshot, { until: (state) => state.keys[0]!.feedback?.text === 'Spotify', schedule: Schedule.spaced(5) });
    assert.strictEqual(snapshot.keys[0]!.feedback!.icon, 'pause'); assert.strictEqual(server.commands().length, 0);
    yield* mock.emit({ _tag: 'KeyDown', key: 0 }); yield* mock.emit({ _tag: 'KeyUp', key: 0 });
    yield* Effect.repeat(studio.snapshot, { until: (state) => state.keys[0]!.feedback?.icon === 'play', schedule: Schedule.spaced(5) });
    assert.deepStrictEqual(server.commands().map((args) => args[8]), ['PlayPause']);
    yield* studio.setPlugin({ id: 'media', enabled: false, expected: true }); const count = server.requests.length;
    yield* Effect.sleep(1100); assert.strictEqual(server.requests.length, count);
  }).pipe(Effect.provide(Layer.mergeAll(mock.layer(), Audio.demoLayer))));
})).pipe(Effect.provide(NodeServices.layer), Effect.timeout('10 seconds')));
