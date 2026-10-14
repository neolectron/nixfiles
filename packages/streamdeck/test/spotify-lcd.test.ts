import { assert, it } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import { Deferred, Effect, Fiber, FileSystem, Layer, Ref, Schedule, Scope } from 'effect';
import { TestClock } from 'effect/testing';
import * as Mpris from '../src/mpris.ts';
import * as Player from '../src/plugins/spotify-player.ts';
import * as Spotify from '../src/plugins/spotify.ts';
import * as SpotifyLcd from '../src/plugins/spotify-lcd.ts';
import * as Plugin from '../src/plugin.ts';
import * as Cards from '../src/mixer-cards.ts';
import * as Audio from '../src/audio.ts';
import * as Mock from '../src/mock.ts';
import * as Takumi from '../src/takumi.ts';
import { IntegrationError } from '../src/json-socket.ts';
import { startStudio } from '../src/scripts/studio.ts';
import { timestamp } from '../src/ui/now-playing-card.ts';

const fixture = Effect.gen(function*() {
  const metadata = yield* Ref.make({ title: 'Life Will Change', artists: ['Lyn'], status: 'Playing' as Mpris.State['status'], position: 30_000_000 });
  const online = yield* Ref.make(true); const requests: ReadonlyArray<string>[] = [];
  const layer = Layer.succeed(Mpris.MprisTransport, { ready: Effect.void, run: (args) => Effect.gen(function*() {
    requests.push(args);
    if (args[5] !== 'org.mpris.MediaPlayer2.spotifast' || !(yield* Ref.get(online))) return yield* Effect.fail(new IntegrationError({ message: 'Player offline' }));
    if (args[8] !== 'GetAll') return '';
    const value = yield* Ref.get(metadata); const bool = (data: boolean) => ({ type: 'b', data });
    return JSON.stringify({ type: 'a{sv}', data: [{ PlaybackStatus: { type: 's', data: value.status }, Position: { type: 'x', data: value.position }, Rate: { type: 'd', data: 1 },
      CanControl: bool(true), CanGoNext: bool(true), CanGoPrevious: bool(true), CanPlay: bool(true), CanPause: bool(true), CanSeek: bool(true),
      Metadata: { type: 'a{sv}', data: { 'xesam:title': { type: 's', data: value.title }, 'xesam:artist': { type: 'as', data: value.artists },
        'mpris:length': { type: 'x', data: 180_000_000 }, 'mpris:trackid': { type: 'o', data: `/track/${value.title.replaceAll(' ', '_')}` } } },
    }] });
  }) });
  return { layer, metadata, online, requests };
});
const spotifyApp: Audio.Application = { key: 'spotifast', name: 'Spotifast', volume: 45, muted: false, mixedMute: false, paused: false,
  streams: [{ index: 1, serial: '1', app: 'spotifast', name: 'Spotifast', channels: [29491, 29491], muted: false, paused: false }] };

it.live('Spotify resolves Spotifast automatically and preserves separate per-application metadata without writes', () => Effect.gen(function*() {
  const source = yield* fixture; const api = yield* Player.make().pipe(Effect.provide(source.layer));
  assert.strictEqual((yield* api.state).title, 'Life Will Change');
  assert.deepStrictEqual(yield* api.applications, [{ key: 'spotifast', name: 'Spotifast' }]);
  assert.strictEqual((yield* Effect.result(api.forApplication('spotify')))._tag, 'Failure');
  assert.strictEqual((yield* api.forApplication('spotifast')).artists[0], 'Lyn');
  assert.ok(source.requests.every((args) => args[8] === 'GetAll'));
}));

it.live('Spotify card toggles without transport commands, freezes on pause and disappears with its scope', () => Effect.scoped(Effect.gen(function*() {
  const source = yield* fixture; const api = yield* Player.make().pipe(Effect.provide(source.layer));
  const cards = yield* Cards.make; const renderer = yield* Takumi.make; const owner = yield* Scope.make();
  yield* SpotifyLcd.register(api).pipe(Effect.provideService(Cards.MixerCards, cards), Effect.provideService(Takumi.ReactRenderer, renderer), Scope.provide(owner));
  assert.strictEqual(yield* cards.frame(spotifyApp, { width: 216, height: 100 }), undefined);
  assert.strictEqual(yield* cards.tap(spotifyApp), true);
  const frame = yield* cards.frame(spotifyApp, { width: 216, height: 100 }); assert.ok(frame);
  const image = yield* frame.draw; assert.ok(image); assert.strictEqual(image.width, 216);
  yield* Ref.update(source.metadata, (value) => ({ ...value, status: 'Paused' as const })); yield* api.current;
  const paused = yield* cards.frame(spotifyApp, { width: 216, height: 100 }); yield* Effect.sleep(20);
  assert.strictEqual((yield* cards.frame(spotifyApp, { width: 216, height: 100 }))?.stamp, paused?.stamp);
  assert.ok(source.requests.every((args) => args[8] === 'GetAll'));
  yield* Scope.close(owner, yield* Effect.exit(Effect.void));
  assert.strictEqual(yield* cards.frame(spotifyApp, { width: 216, height: 100 }), undefined);
  assert.strictEqual(yield* frame.draw, undefined); assert.strictEqual(yield* cards.tap(spotifyApp), false);
})).pipe(Effect.provide(NodeServices.layer)));

it.effect('rotation overlays volume without collapsing the track and preserves timeout and explicit view choices', () => Effect.scoped(Effect.gen(function*() {
  const source = yield* fixture; const api = yield* Player.make().pipe(Effect.provide(source.layer));
  const cards = yield* Cards.make; const renderer = yield* Takumi.make; const shown = yield* Ref.make(false);
  const observed = { ...renderer, rgb: (view: Parameters<typeof renderer.rgb>[0], size: Parameters<typeof renderer.rgb>[1]) =>
    Ref.set(shown, (view.props as { volumeOverlay: boolean }).volumeOverlay).pipe(Effect.andThen(renderer.rgb(view, size))) };
  yield* SpotifyLcd.register(api).pipe(Effect.provideService(Cards.MixerCards, cards), Effect.provideService(Takumi.ReactRenderer, observed));
  const frame = cards.frame(spotifyApp, { width: 216, height: 100 }, { width: 648, height: 100 });
  const overlay = Effect.gen(function*() { const current = yield* frame; assert.ok(current); assert.strictEqual(current.size.width, 648); yield* current.draw; return yield* Ref.get(shown); });
  yield* cards.tap(spotifyApp); assert.strictEqual(yield* overlay, false);
  yield* cards.adjust(spotifyApp, { delta: 2, toggles: 0 }); assert.strictEqual(yield* overlay, true);
  yield* TestClock.adjust(1000);
  yield* cards.adjust(spotifyApp, { delta: -2, toggles: 0 });
  yield* TestClock.adjust(1000); assert.strictEqual(yield* overlay, true);
  yield* TestClock.adjust(500); assert.strictEqual(yield* overlay, false);
  yield* cards.adjust({ ...spotifyApp, key: 'spotify' }, { delta: 2, toggles: 0 }); assert.strictEqual(yield* overlay, false);
  yield* cards.adjust(spotifyApp, { delta: 0, toggles: 1 }); assert.strictEqual(yield* overlay, false);
  yield* cards.adjust(spotifyApp, { delta: 2, toggles: 0 });
  yield* cards.tap(spotifyApp); yield* TestClock.adjust(1500); assert.strictEqual(yield* frame, undefined);
  yield* cards.tap(spotifyApp); assert.strictEqual(yield* overlay, false);
  yield* cards.adjust(spotifyApp, { delta: 2, toggles: 0 });
  yield* cards.tap(spotifyApp); yield* cards.tap(spotifyApp); assert.strictEqual(yield* overlay, false);
  assert.ok(source.requests.every((args) => args[8] === 'GetAll'));
})).pipe(Effect.provide(NodeServices.layer)));

it.live('physical LCD tap and web tap share Spotify view state, retain paused cards and keep other controls', () => Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem; const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'spotify-lcd-' });
  const mock = Mock.make(); const source = yield* fixture;
  const apps = yield* Ref.make<ReadonlyArray<Audio.Application>>([spotifyApp]); const changes: Array<[string, Audio.Change]> = [];
  const audio = Layer.succeed(Audio.Audio, { list: Ref.get(apps), change: (key, change) => Effect.sync(() => { changes.push([key, change]); }), master: Effect.succeed(undefined), changeMaster: () => Effect.void });
  const player = Layer.effect(Spotify.Spotify, Player.make().pipe(Effect.provide(source.layer)));
  // Reuse the real plugin run (including scoped card registration), with only its transport replaced.
  const plugin = Plugin.fromLayer({ ...Spotify.plugin, service: Spotify.Spotify, layer: player, run: Spotify.run });
  yield* Effect.scoped(Effect.gen(function*() {
    const studio = yield* startStudio({ profile: `${directory}/profile.json`, applications: [], mock: true, configurePlugins: (host) => host.install(plugin) });
    yield* studio.setPlugin({ id: 'spotify', enabled: true, expected: false });
    const initial = yield* Effect.repeat(studio.snapshot, { until: (state) => !!state.dials.find((dial) => dial.key === 'spotifast')?.interaction, schedule: Schedule.spaced(5) });
    const slot = initial.dials.find((dial) => dial.key === 'spotifast')!; const before = initial.lcds[0]!.revision;
    yield* mock.emit({ _tag: 'TouchTap', lcd: 0, position: { x: slot.x + 10, y: 30 } });
    const track = yield* Effect.repeat(studio.snapshot, { until: (state) => state.lcds[0]!.revision > before, schedule: Schedule.spaced(5) });
    const wide = track.dials.find((dial) => dial.key === 'spotifast')!;
    assert.strictEqual(wide.cardWidth, track.dials.find((dial) => dial.master)!.x - wide.x);
    // The empty slots covered by the track also belong to its physical touch area.
    const trackRevision = track.lcds[0]!.revision;
    yield* mock.emit({ _tag: 'TouchTap', lcd: 0, position: { x: wide.x + wide.cardWidth - 1, y: 30 } });
    yield* Effect.repeat(studio.snapshot, { until: (state) => state.lcds[0]!.revision > trackRevision && state.dials.find((dial) => dial.key === 'spotifast')!.cardWidth === wide.width, schedule: Schedule.spaced(5) });
    yield* studio.lcdTap({ dial: slot.index, application: 'spotifast', page: 0 });
    yield* mock.emit({ _tag: 'DialRotate', dial: slot.index, delta: 1 });
    yield* Effect.repeat(Effect.sync(() => changes.length), { until: (count) => count > 0, schedule: Schedule.spaced(5) });
    assert.strictEqual(changes[0]![0], 'spotifast');
    yield* studio.lcdTap({ dial: slot.index, application: 'spotifast', page: 0 });
    assert.ok((yield* studio.snapshot).lcds[0]!.revision > track.lcds[0]!.revision);
    assert.strictEqual((yield* Effect.result(studio.lcdTap({ dial: slot.index, application: 'other', page: 0 })))._tag, 'Failure');
    yield* Ref.set(apps, []); yield* Ref.update(source.metadata, (value) => ({ ...value, status: 'Paused' as const }));
    const retained = yield* Effect.repeat(studio.snapshot, { until: (state) => state.dials.some((dial) => dial.key === 'spotifast'), schedule: Schedule.spaced(5) });
    assert.strictEqual(retained.dials.find((dial) => dial.key === 'spotifast')!.index, slot.index);
    yield* Effect.sleep(600); assert.ok((yield* studio.snapshot).dials.some((dial) => dial.key === 'spotifast'));
    yield* studio.setPlugin({ id: 'spotify', enabled: false, expected: true });
    const stopped = yield* Effect.repeat(studio.snapshot, { until: (state) => !state.dials.some((dial) => dial.key === 'spotifast'), schedule: Schedule.spaced(5) });
    assert.ok(stopped.keys.every((key) => key.binding === null));
    assert.ok(source.requests.every((args) => args[8] === 'GetAll'));
  }).pipe(Effect.provide(Layer.mergeAll(mock.layer(), audio))));
})).pipe(Effect.provide(NodeServices.layer), Effect.timeout('10 seconds')));

it.live('disabling a card owner interrupts in-flight rendering rather than allowing an old view to draw', () => Effect.scoped(Effect.gen(function*() {
  const cards = yield* Cards.make; const owner = yield* Scope.make(); const started = yield* Deferred.make<void>(); const stopped = yield* Ref.make(false);
  yield* cards.register({ id: 'slow', matches: () => true,
    frame: () => Effect.succeed({ stamp: 'one', draw: Effect.acquireRelease(Deferred.succeed(started, undefined), () => Ref.set(stopped, true)).pipe(Effect.andThen(Effect.never)) }),
  }).pipe(Scope.provide(owner));
  const frame = yield* cards.frame(spotifyApp, { width: 216, height: 100 }); assert.ok(frame);
  const fiber = yield* Effect.forkScoped(frame.draw); yield* Deferred.await(started);
  yield* Scope.close(owner, yield* Effect.exit(Effect.void));
  assert.strictEqual(yield* Fiber.join(fiber), undefined); assert.strictEqual(yield* Ref.get(stopped), true);
})));

it('timestamps keep minute and hour-long tracks legible and missing timing explicit', () => {
  assert.strictEqual(timestamp(0), '0:00'); assert.strictEqual(timestamp(3_661_000_000), '61:01'); assert.strictEqual(timestamp(null), '—:—');
});
