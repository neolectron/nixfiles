import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Deferred, Effect, Fiber, Layer } from 'effect';
import { Audio, AudioError, Pactl, decodeInputs, group, serviceLayer, type Application, type Master } from '../src/audio.js';
import { Mock, type Control } from '../src/index.js';
import { assign, slotsFor, startMixer } from '../src/scripts/audio-mixer.js';

const input = (index: number, binary: string, values: number[], mute = false, serial = String(index)) => ({
  index, mute, corked: false,
  volume: Object.fromEntries(values.map((value, i) => [`channel-${i}`, { value }])),
  properties: { 'application.name': binary === 'Discord' ? 'WEBRTC VoiceEngine' : binary,
    'application.process.binary': `.${binary}-wrapped`, 'object.serial': serial, 'media.class': 'Stream/Output/Audio' },
});
const fixture = (initial = [input(7415, 'Spotify', [13107, 13107]), input(28015, 'Discord', [65536, 0])]) => {
  let sink = { name: 'output', mute: false, volume: { left: { value: 32768 }, right: { value: 16384 } }, properties: { 'object.serial': 'sink-1' } };
  let defaultSink = sink.name;
  let inputs = initial;
  let reads = 0;
  const commands: string[][] = [];
  let onRead: ((count: number) => void) | undefined;
  const pactl = Layer.succeed(Pactl, Pactl.of({ run: (args) => Effect.sync(() => {
    if (args[0] === 'get-default-sink') return `${defaultSink}\n`;
    if (args[0] === '--format=json' && args[2] === 'sinks') return JSON.stringify([sink]);
    if (args[0] === '--format=json') { onRead?.(++reads); return JSON.stringify(inputs); }
    commands.push([...args]);
    if (args[0] === 'set-sink-mute') sink = { ...sink, mute: args[2] === '1' };
    if (args[0] === 'set-sink-volume') sink = { ...sink, volume: { left: { value: Number(args[2]) }, right: { value: Number(args[3]) } } };
    inputs = inputs.map((row) => row.index !== Number(args[1]) ? row : {
      ...row,
      ...(args[0] === 'set-sink-input-mute' ? { mute: args[2] === '1' } : {}),
      ...(args[0] === 'set-sink-input-volume' ? { volume: Object.fromEntries(Object.keys(row.volume).map((channel, i) => [channel, { value: Number(args[i + 2]) }])) } : {}),
    });
    return '';
  }) }));
  return { commands, layer: serviceLayer.pipe(Layer.provide(pactl)), set: (next: typeof initial) => { inputs = next; },
    onRead: (callback: (count: number) => void) => { onRead = callback; },
    replaceSink: (name: string, serial: string) => { defaultSink = name; sink = { ...sink, name, properties: { 'object.serial': serial } }; },
    removeDefault: () => { defaultSink = ''; } };
};
const run = <A, E>(body: Effect.Effect<A, E, Audio>, f: ReturnType<typeof fixture>) => Effect.runPromise(body.pipe(Effect.provide(f.layer)));
const app = (key: string): Application => ({ key, name: key, streams: [], volume: 50, muted: false, mixedMute: false, paused: false });
const master: Master = { name: 'output', serial: 'sink-1', channels: [32768, 16384], volume: 50, muted: false };
const masterMock = { master: Effect.succeed(master), changeMaster: () => Effect.void };

test('playback decoding filters capture/system nodes, identifies Discord and groups app streams', async () => {
  const system = { ...input(3, 'system', [65536]), properties: {} };
  const capture = input(4, 'microphone', [65536]); capture.properties['media.class'] = 'Stream/Input/Audio';
  const apps = group(await Effect.runPromise(decodeInputs(JSON.stringify([
    input(1, 'Discord', [65536, 0]), input(2, 'Discord', [32768, 0], true), system, capture,
  ]))));
  assert.equal(apps.length, 1); assert.equal(apps[0]!.name, 'Discord'); assert.equal(apps[0]!.key, 'discord');
  assert.equal(apps[0]!.streams.length, 2); assert.equal(apps[0]!.volume, 100); assert.equal(apps[0]!.mixedMute, true);
  for (const json of ['broken', '[{"index":1}]']) await assert.rejects(Effect.runPromise(decodeInputs(json)), AudioError);
});

test('volume changes preserve channel balance and relative levels across streams', async () => {
  const f = fixture([input(1, 'Discord', [65536, 0]), input(2, 'Discord', [32768, 0])]);
  await run(Effect.flatMap(Audio, (audio) => audio.change('discord', { delta: -2, toggles: 0 })), f);
  assert.deepEqual(f.commands, [['set-sink-input-volume', '1', '64225', '0'], ['set-sink-input-volume', '2', '32113', '0']]);
});

test('click mutes a mixed group coherently, second click unmutes all streams', async () => {
  const f = fixture([input(1, 'Discord', [65536, 0]), input(2, 'Discord', [32768, 0], true)]);
  await run(Effect.gen(function*() {
    const audio = yield* Audio;
    yield* audio.change('discord', { delta: 0, toggles: 1 });
    assert.equal((yield* audio.list)[0]!.muted, true);
    yield* audio.change('discord', { delta: 0, toggles: 1 });
  }), f);
  assert.deepEqual(f.commands.map((args) => args.slice(0, 3)), [
    ['set-sink-input-mute', '1', '1'], ['set-sink-input-mute', '2', '1'],
    ['set-sink-input-mute', '1', '0'], ['set-sink-input-mute', '2', '0'],
  ]);
});

test('disappearing or recycled stream indices never target a different application', async () => {
  const f = fixture([input(1, 'Spotify', [65536])]);
  f.onRead((count) => { if (count === 2) f.set([input(1, 'Discord', [65536], false, 'new')]); });
  await run(Effect.gen(function*() {
    const audio = yield* Audio;
    yield* audio.change('spotify', { delta: 2, toggles: 1 });
    yield* audio.change('missing', { delta: 2, toggles: 1 });
  }), f);
  assert.deepEqual(f.commands, []);
});

test('volume clamps at 100%, can rise from silence and does not automatically unmute', async () => {
  const f = fixture([input(1, 'Spotify', [0, 0], true)]);
  await run(Effect.gen(function*() {
    const audio = yield* Audio;
    yield* audio.change('spotify', { delta: 2, toggles: 0 });
    assert.equal((yield* audio.list)[0]!.muted, true);
    yield* audio.change('spotify', { delta: 1000, toggles: 0 });
  }), f);
  assert.deepEqual(f.commands, [['set-sink-input-volume', '1', '1311', '1311'], ['set-sink-input-volume', '1', '65536', '65536']]);
  f.set([input(1, 'Spotify', [98304])]);
  await run(Effect.flatMap(Audio, (audio) => audio.change('spotify', { delta: 2, toggles: 0 })), f);
  assert.equal(f.commands.at(-1)![2], '98304');
  await run(Effect.flatMap(Audio, (audio) => audio.change('spotify', { delta: -10, toggles: 0 })), f);
  assert.equal(f.commands.at(-1)![2], '91750');
});

test('invalid changes fail without playback mutations', async () => {
  const f = fixture();
  for (const change of [{ delta: NaN, toggles: 0 }, { delta: 0, toggles: -1 }]) {
    await assert.rejects(run(Effect.flatMap(Audio, (audio) => audio.change('spotify', change)), f), AudioError);
  }
  assert.deepEqual(f.commands, []);
});

test('app slots remain stable, fill holes and paginate beyond the dial count', () => {
  assert.deepEqual(assign(['a', 'b', 'c'], [app('c'), app('a'), app('d')]), ['a', 'd', 'c']);
  assert.deepEqual(assign(['a', null, 'c'], [app('a')]), ['a']);
  assert.equal(assign([], Array.from({ length: 8 }, (_, i) => app(`app${i}`))).length, 8);
});

test('LCD regions follow actual knob geometry and exactly cover the screen', () => {
  const dials: Control[] = Array.from({ length: 6 }, (_, index) => ({ type: 'encoder', index,
    bounds: { x: 44 + index * 216, y: 0, width: 112, height: 112 } }));
  const lcd: Control = { type: 'lcd-segment', index: 0, pixelSize: { width: 1200, height: 100 }, bounds: { x: 40, y: 0, width: 1200, height: 100 } };
  const slots = slotsFor(dials, lcd);
  assert.deepEqual(slots.map((slot) => slot.width), [168, 216, 216, 216, 216, 168]);
  assert.equal(slots.at(-1)!.x + slots.at(-1)!.width, 1200);
});

test('mixer startup only renders; batched ticks and clicks change the app actually displayed', async () => {
  const deck = Mock.make(); const f = fixture();
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const mixer = yield* startMixer();
    assert.deepEqual(f.commands, []); assert.equal(deck.writes.length, 6);
    assert.deepEqual((yield* mixer.state).assignments, ['discord', 'spotify']);
    yield* mixer.adjustDial(1, 1); yield* mixer.adjustDial(1, 2); yield* mixer.toggleDial(1);
    yield* mixer.flush;
    assert.deepEqual(f.commands, [['set-sink-input-volume', '7415', '17039', '17039'], ['set-sink-input-mute', '7415', '1']]);
    const writes = deck.writes.length; yield* mixer.refresh; assert.equal(deck.writes.length, writes);
  })).pipe(Effect.provide(Layer.mergeAll(deck.layer(), f.layer))));
  assert.equal(deck.closes, 1);
});

test('page changes keep pending actions bound to the original app and empty dials do nothing', async () => {
  const deck = Mock.make(); const f = fixture(Array.from({ length: 8 }, (_, i) => input(i + 1, `App${i}`, [32768])));
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const mixer = yield* startMixer();
    yield* mixer.adjustDial(0, 1); yield* mixer.changePage(1); yield* mixer.toggleDial(0); yield* mixer.toggleDial(4); yield* mixer.flush;
    assert.deepEqual(f.commands, [['set-sink-input-volume', '1', '34079'], ['set-sink-input-mute', '6', '1']]);
    assert.equal((yield* mixer.state).page, 1);
  })).pipe(Effect.provide(Layer.mergeAll(deck.layer(), f.layer))));
});

test('offline feedback disables actions and reconnect restores the existing app slots', async () => {
  const deck = Mock.make(); let offline = false; let changes = 0;
  const audio = Layer.succeed(Audio, Audio.of({ ...masterMock, list: Effect.suspend(() => offline
    ? Effect.fail(new AudioError({ operation: 'list', message: 'offline' })) : Effect.succeed([app('spotify')])),
    change: () => Effect.sync(() => { changes++; }) }));
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const mixer = yield* startMixer(); offline = true; yield* mixer.refresh;
    assert.equal((yield* mixer.state).online, false);
    yield* mixer.adjustDial(0, 1); yield* mixer.toggleDial(0); yield* mixer.flush; assert.equal(changes, 0);
    offline = false; yield* mixer.refresh; assert.deepEqual((yield* mixer.state).assignments, ['spotify']);
  })).pipe(Effect.provide(Layer.mergeAll(deck.layer(), audio))));
});

test('encoder events route through the Effect binding runner', async () => {
  const deck = Mock.make(); const written = Deferred.makeUnsafe<void>(); let changeKey = '';
  const audio = Layer.succeed(Audio, Audio.of({ ...masterMock, list: Effect.succeed([app('spotify')]), change: (key) => Effect.sync(() => { changeKey = key; }).pipe(Effect.andThen(Deferred.succeed(written, undefined)), Effect.asVoid) }));
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const mixer = yield* startMixer({ flushMillis: 1 }); const fiber = yield* Effect.forkScoped(mixer.run);
    yield* deck.emit({ _tag: 'DialRotate', dial: 0, delta: 1 }); yield* Deferred.await(written); yield* Fiber.interrupt(fiber);
  })).pipe(Effect.provide(Layer.mergeAll(deck.layer(), audio)), Effect.timeout('2 seconds')));
  assert.equal(changeKey, 'spotify'); assert.equal(deck.closes, 1);
});

test('CLI mock mixer runs with neither pactl nor native HID available and validates step', () => {
  const cli = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'mixer', ...args], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, PATH: '/nonexistent', LD_LIBRARY_PATH: '' },
  });
  const result = cli('--mock', '--duration', '0.1'); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /mixer-ready/);
  for (const step of ['0', 'NaN', '21']) assert.equal(cli('--mock', '--step', step).status, 1);
});

test('master controls only the default sink, preserves balance, and leaves app volumes alone', async () => {
  const f = fixture();
  await run(Effect.gen(function*() {
    const audio = yield* Audio; const target = yield* audio.master; assert.ok(target);
    yield* audio.changeMaster(target, { delta: 2, toggles: 1 });
    const muted = yield* audio.master; assert.ok(muted); assert.equal(muted.muted, true);
    yield* audio.changeMaster(muted, { delta: -2, toggles: 0 });
    assert.equal((yield* audio.master)!.muted, true);
    yield* audio.changeMaster(muted, { delta: 0, toggles: 1 });
    assert.equal((yield* audio.master)!.muted, false);
    assert.equal(Math.round((yield* audio.list).find((app) => app.key === 'spotify')!.volume), 20);
  }), f);
  assert.deepEqual(f.commands, [
    ['set-sink-volume', 'output', '34079', '17039'], ['set-sink-mute', 'output', '1'],
    ['set-sink-volume', 'output', '32768', '16384'], ['set-sink-mute', 'output', '0'],
  ]);
});

test('pending master changes do not spill onto a different or recreated default sink', async () => {
  const f = fixture();
  await run(Effect.gen(function*() {
    const audio = yield* Audio; const previous = yield* audio.master; assert.ok(previous);
    for (const [name, serial] of [['headphones', 'sink-2'], ['output', 'sink-3']]) {
      f.replaceSink(name!, serial!); yield* audio.changeMaster(previous, { delta: 2, toggles: 1 });
    }
    f.removeDefault(); assert.equal(yield* audio.master, undefined);
    yield* audio.changeMaster(previous, { delta: 2, toggles: 1 });
  }), f);
  assert.deepEqual(f.commands, []);
});

test('rightmost dial is reserved for master across pages; app pagination uses five slots', async () => {
  const deck = Mock.make(); const f = fixture(Array.from({ length: 6 }, (_, i) => input(i + 1, `App${i}`, [32768])));
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const mixer = yield* startMixer();
    assert.deepEqual(f.commands, []);
    yield* mixer.adjustDial(5, 1); yield* mixer.changePage(1); yield* mixer.toggleDial(5); yield* mixer.toggleDial(0); yield* mixer.flush;
    assert.deepEqual(f.commands, [['set-sink-input-mute', '6', '1'], ['set-sink-volume', 'output', '34079', '17039'], ['set-sink-mute', 'output', '1']]);
    assert.equal((yield* mixer.state).page, 1); assert.equal((yield* mixer.state).master!.muted, true);
  })).pipe(Effect.provide(Layer.mergeAll(deck.layer(), f.layer))));
});

test('master read failure disables its dial while app controls remain usable', async () => {
  const deck = Mock.make(); let appChanges = 0; let masterChanges = 0;
  const audio = Layer.succeed(Audio, Audio.of({ list: Effect.succeed([app('spotify')]),
    master: Effect.fail(new AudioError({ operation: 'master', message: 'unavailable' })),
    change: () => Effect.sync(() => { appChanges++; }), changeMaster: () => Effect.sync(() => { masterChanges++; }) }));
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const mixer = yield* startMixer(); yield* mixer.toggleDial(5); yield* mixer.adjustDial(5, 1); yield* mixer.toggleDial(0); yield* mixer.flush;
    assert.equal(appChanges, 1); assert.equal(masterChanges, 0); assert.equal((yield* mixer.state).masterOnline, false);
  })).pipe(Effect.provide(Layer.mergeAll(deck.layer(), audio))));
});
