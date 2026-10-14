import { assert, it } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Layer, Ref, Schedule } from 'effect';
import { IntegrationError } from '../src/json-socket.ts';
import * as Mpris from '../src/mpris.ts';
import * as Spotify from '../src/plugins/spotify.ts';
import * as Plugin from '../src/plugin.ts';
import * as Mock from '../src/mock.ts';
import * as Audio from '../src/audio.ts';
import { startStudio } from '../src/scripts/studio.ts';

const fake = Effect.gen(function*() {
  const state = yield* Ref.make<Mpris.State>({ status: 'Playing', title: 'Life Will Change', artists: ['Lyn'], canControl: true, canNext: true, canPrevious: true, canPlay: true, canPause: true, canSeek: true, shuffle: false, loop: 'None', trackId: '/com/spotify/track/one', durationMicros: 300_000_000, positionMicros: 90_000_000, sampledAt: 0, rate: 1, artUrl: null });
  const mode = yield* Ref.make<'online' | 'offline' | 'malformed'>('online');
  const requests: ReadonlyArray<string>[] = [];
  const layer = Layer.succeed(Mpris.MprisTransport, { ready: Effect.void, run: (args) => Effect.gen(function*() {
    requests.push(args); assert.deepStrictEqual(args.slice(0, 4), ['--user', '--json=short', '--timeout=2s', '--auto-start=no']);
    assert.strictEqual(args[5], 'org.mpris.MediaPlayer2.spotify');
    const connection = yield* Ref.get(mode);
    if (connection === 'offline') return yield* Effect.fail(new IntegrationError({ message: 'Spotify absent' }));
    if (args[8] === 'GetAll') {
      assert.strictEqual(args[7], 'org.freedesktop.DBus.Properties'); assert.deepStrictEqual(args.slice(9), ['s', 'org.mpris.MediaPlayer2.Player']);
      if (connection === 'malformed') return '{"type":"a{sv}","data":[{"PlaybackStatus":{"type":"s","data":"maybe"}}]}';
      const value = yield* Ref.get(state); const bool = (data: boolean) => ({ type: 'b', data });
      return JSON.stringify({ type: 'a{sv}', data: [{ PlaybackStatus: { type: 's', data: value.status },
        Position: { type: 'x', data: value.positionMicros }, Rate: { type: 'd', data: value.rate },
        CanControl: bool(value.canControl), CanGoNext: bool(value.canNext), CanGoPrevious: bool(value.canPrevious), CanPlay: bool(value.canPlay), CanPause: bool(value.canPause), CanSeek: bool(value.canSeek),
        ...(value.shuffle === null ? {} : { Shuffle: bool(value.shuffle) }), ...(value.loop === null ? {} : { LoopStatus: { type: 's', data: value.loop } }),
        Metadata: { type: 'a{sv}', data: { 'xesam:title': { type: 's', data: value.title }, 'xesam:artist': { type: 'as', data: value.artists }, 'mpris:trackid': { type: 'o', data: value.trackId }, 'mpris:length': { type: 'x', data: value.durationMicros }, ...(value.artUrl ? { 'mpris:artUrl': { type: 's', data: value.artUrl } } : {}) } },
      }] });
    }
    assert.strictEqual(args[7], 'org.mpris.MediaPlayer2.Player');
    if (args[4] === 'set-property') {
      if (args[8] === 'Shuffle') yield* Ref.update(state, (before) => ({ ...before, shuffle: args[10] === 'true' }));
      else yield* Ref.update(state, (before) => ({ ...before, loop: args[10] as Mpris.State['loop'] }));
    } else if (args[8] === 'PlayPause') yield* Ref.update(state, (before): Mpris.State => ({ ...before, status: before.status === 'Playing' ? 'Paused' : 'Playing' }));
    else if (args[8] === 'Play' || args[8] === 'Pause' || args[8] === 'Stop') yield* Ref.update(state, (before): Mpris.State => ({ ...before, status: args[8] === 'Play' ? 'Playing' : args[8] === 'Pause' ? 'Paused' : 'Stopped' }));
    return '';
  }) });
  return { layer, state, mode, requests, change: (patch: Partial<Mpris.State>) => Ref.update(state, (before) => ({ ...before, ...patch })) };
});
const mutations = (requests: ReadonlyArray<ReadonlyArray<string>>) => requests.filter((args) => args[8] !== 'GetAll');

it.live('MPRIS decodes busctl variants and sends targeted literal commands, serialized toggles and signed seeks', () => Effect.gen(function*() {
  const server = yield* fake; const api = yield* Mpris.make('org.mpris.MediaPlayer2.spotify').pipe(Effect.provide(server.layer));
  assert.strictEqual(mutations(server.requests).length, 0); assert.strictEqual((yield* api.state).title, 'Life Will Change'); assert.deepStrictEqual((yield* api.state).artists, ['Lyn']);
  yield* Effect.all([api.command('PlayPause'), api.command('PlayPause')], { concurrency: 'unbounded' }); assert.strictEqual((yield* api.state).status, 'Playing');
  yield* Effect.all([api.toggleShuffle, api.toggleShuffle], { concurrency: 'unbounded' }); assert.strictEqual((yield* api.state).shuffle, false);
  yield* api.cycleLoop; yield* api.cycleLoop; yield* api.cycleLoop; assert.strictEqual((yield* api.state).loop, 'None');
  yield* api.command('Next'); yield* api.command('Previous'); yield* api.seek(-10);
  const sent = mutations(server.requests);
  assert.deepStrictEqual(sent.filter((args) => args[8] === 'LoopStatus').map((args) => args.slice(9)), [['s', 'Playlist'], ['s', 'Track'], ['s', 'None']]);
  assert.deepStrictEqual(sent.at(-1)!.slice(8), ['Seek', 'x', '-10000000']);
  yield* api.command('Pause'); assert.strictEqual((yield* api.state).status, 'Paused'); yield* api.command('Play'); yield* api.command('Stop'); assert.strictEqual((yield* api.state).status, 'Stopped');
}));

it.live('MPRIS track timing uses microseconds, advances only during playback and clamps at the duration', () => Effect.gen(function*() {
  const server = yield* fake; const api = yield* Mpris.make('org.mpris.MediaPlayer2.spotify').pipe(Effect.provide(server.layer));
  const playing = yield* api.state;
  assert.strictEqual(playing.artUrl, null);
  yield* server.change({ artUrl: 'https://example.invalid/album.jpg' });
  assert.strictEqual((yield* api.current).artUrl, 'https://example.invalid/album.jpg');
  assert.strictEqual(playing.trackId, '/com/spotify/track/one'); assert.strictEqual(playing.durationMicros, 300_000_000);
  assert.strictEqual(Mpris.positionAt(playing, playing.sampledAt + 5000), 95_000_000);
  assert.strictEqual(Mpris.positionAt(playing, playing.sampledAt + 999999), 300_000_000);
  assert.strictEqual(Mpris.positionAt({ ...playing, rate: 2 }, playing.sampledAt + 5000), 100_000_000);
  yield* server.change({ status: 'Paused' }); const paused = yield* api.current;
  assert.strictEqual(Mpris.positionAt(paused, paused.sampledAt + 999999), 90_000_000);
  assert.strictEqual(Mpris.positionAt({ ...paused, positionMicros: null }, paused.sampledAt), null);
}));

it.live('capabilities and unsupported optional properties reject commands without sending mutations', () => Effect.gen(function*() {
  const server = yield* fake; yield* server.change({ canNext: false, canPrevious: false, canPause: false, canSeek: false, shuffle: null, loop: null });
  const api = yield* Mpris.make('org.mpris.MediaPlayer2.spotify').pipe(Effect.provide(server.layer));
  for (const action of [api.command('Next'), api.command('Previous'), api.command('PlayPause'), api.seek(10), api.seek(Infinity), api.seek(301), api.toggleShuffle, api.cycleLoop]) assert.strictEqual((yield* Effect.result(action))._tag, 'Failure');
  yield* server.change({ canControl: false }); assert.strictEqual((yield* Effect.result(api.command('Play')))._tag, 'Failure');
  assert.strictEqual(mutations(server.requests).length, 0);
}));

it.live('a D-Bus acknowledgment preceding the property change is confirmed by reads without replaying the toggle', () => Effect.gen(function*() {
  const server = yield* fake; let pending = false; let reads = 0; let toggles = 0;
  const original = yield* Mpris.MprisTransport.pipe(Effect.provide(server.layer));
  const delayed = Layer.succeed(Mpris.MprisTransport, { ready: original.ready, run: (args) => Effect.gen(function*() {
    if (args[8] === 'PlayPause') { toggles++; pending = true; return ''; }
    if (pending && args[8] === 'GetAll' && ++reads === 3) { pending = false; yield* server.change({ status: 'Paused' }); }
    return yield* original.run(args);
  }) });
  const api = yield* Mpris.make('org.mpris.MediaPlayer2.spotify').pipe(Effect.provide(delayed));
  assert.strictEqual((yield* api.command('PlayPause')).status, 'Paused'); assert.strictEqual(reads, 3); assert.strictEqual(toggles, 1);
}).pipe(Effect.scoped));

it.live('offline and malformed state never masquerade as paused, and valid state can recover', () => Effect.gen(function*() {
  const server = yield* fake; yield* Ref.set(server.mode, 'offline');
  const api = yield* Mpris.make('org.mpris.MediaPlayer2.spotify').pipe(Effect.provide(server.layer));
  assert.strictEqual((yield* Effect.result(api.state))._tag, 'Failure'); assert.strictEqual((yield* Effect.result(api.command('Next')))._tag, 'Failure');
  yield* Ref.set(server.mode, 'malformed'); assert.strictEqual((yield* Effect.result(api.current))._tag, 'Failure');
  yield* Ref.set(server.mode, 'online'); yield* api.current; assert.strictEqual((yield* api.state).status, 'Playing');
  assert.strictEqual(mutations(server.requests).length, 0);
  assert.strictEqual((yield* Effect.result(Mpris.make('spotify; other-command').pipe(Effect.provide(server.layer))))._tag, 'Failure');
}));

it.live('Spotify plugin renders real-state feedback, resumes after app reopening and stops its monitor when disabled', () => Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem; const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'spotify-plugin-' }); const mock = Mock.make(); const server = yield* fake;
  const layer = Layer.effect(Spotify.Spotify, Mpris.make('org.mpris.MediaPlayer2.spotify').pipe(Effect.provide(server.layer)));
  const plugin = Plugin.fromLayer({ ...Spotify.plugin, service: Spotify.Spotify, layer, run: (api) => api.monitor });
  yield* Effect.scoped(Effect.gen(function*() {
    const studio = yield* startStudio({ profile: `${directory}/profile.json`, applications: [], mock: true, configurePlugins: (host) => host.install(plugin) });
    yield* studio.actions.save(0, { label: 'Lecture / pause', action: 'plugin', parameters: { plugin: 'spotify', command: 'play-pause', input: {} } });
    const read = (text: string) => Effect.repeat(studio.snapshot, { until: (view) => view.keys[0]!.feedback?.text === text, schedule: Schedule.spaced(5) });
    yield* read('HORS LIGNE'); yield* studio.setPlugin({ id: 'spotify', enabled: true, expected: false });
    const playing = yield* read('LECTURE'); assert.strictEqual(playing.keys[0]!.feedback!.icon, 'pause'); assert.strictEqual(mutations(server.requests).length, 0);
    yield* studio.actions.press(0); const paused = yield* read('PAUSE'); assert.strictEqual(paused.keys[0]!.feedback!.icon, 'play');
    yield* Ref.set(server.mode, 'offline'); const offline = yield* read('HORS LIGNE'); assert.strictEqual(offline.plugins.items.find((plugin) => plugin.id === 'spotify')!.phase, 'enabled');
    yield* server.change({ status: 'Playing' }); yield* Ref.set(server.mode, 'online'); yield* read('LECTURE');
    const writes = mock.writes.length; yield* Effect.sleep(550); assert.strictEqual(mock.writes.length, writes);
    yield* studio.setPlugin({ id: 'spotify', enabled: false, expected: true }); yield* read('HORS LIGNE');
    const requests = server.requests.length; yield* Effect.sleep(1100); assert.strictEqual(server.requests.length, requests);
    assert.strictEqual(mutations(server.requests).length, 1);
  }).pipe(Effect.provide(Layer.mergeAll(mock.layer(), Audio.demoLayer))));
})).pipe(Effect.provide(NodeServices.layer), Effect.timeout('10 seconds')));

it.live('Spotify action schemas reject invalid seek values and do not accept hidden parameters', () => Effect.gen(function*() {
  const seek = Spotify.plugin.actions!.find((action) => action.info.id === 'seek')!;
  assert.strictEqual((yield* Effect.result(seek.validate({ seconds: -15 })))._tag, 'Success');
  for (const input of [{ seconds: 301 }, { seconds: NaN }, { seconds: -Infinity }, { seconds: 10, executable: 'anything' }]) assert.strictEqual((yield* Effect.result(seek.validate(input)))._tag, 'Failure');
  const play = Spotify.plugin.actions!.find((action) => action.info.id === 'play-pause')!;
  assert.strictEqual((yield* Effect.result(play.validate({ busName: 'other-player' })))._tag, 'Failure');
}));
