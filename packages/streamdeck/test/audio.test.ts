import * as AudioModule from '@nixfiles/system-control/audio.ts';
import { assert, expect, it, test } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import { Deferred, Effect, Fiber, Layer, Schedule } from 'effect';
import {
  Audio,
  AudioError,
  Pactl,
  PULSE_VOLUME_MAX,
  MAX_MASTER_VOLUME_PERCENT,
  MAX_VOLUME_PERCENT,
  decodeInputs,
  decodeSinks,
  group,
  serviceLayer,
  mockLayer,
  type Application,
  type Master,
} from '@nixfiles/system-control/audio.ts';
import * as Mock from '../src/mock.ts';
import * as Cards from '../src/mixer-cards.ts';
import * as Image from '../src/image.ts';
import type { Control } from '../src/model.ts';
import { assign, slotsFor, make as startMixer } from '../src/plugins/audio-mixer.ts';
import { card } from '../src/mixer-display.ts';
import { volumeColor } from '../src/volume-gauge.ts';
import { cli } from './cli.ts';

const input = (
  index: number,
  binary: string,
  values: number[],
  mute = false,
  serial = String(index),
) => ({
  index,
  mute,
  corked: false,
  volume: Object.fromEntries(values.map((value, i) => [`channel-${i}`, { value }])),
  properties: {
    'application.name': binary === 'Discord' ? 'WEBRTC VoiceEngine' : binary,
    'application.process.binary': `.${binary}-wrapped`,
    'object.serial': serial,
    'media.class': 'Stream/Output/Audio',
  },
});
const fixture = (
  initial = [input(7415, 'Spotify', [13107, 13107]), input(28015, 'Discord', [65536, 0])],
) => {
  let sink = {
    name: 'output',
    mute: false,
    volume: { left: { value: 32768 }, right: { value: 16384 } },
    properties: { 'object.serial': 'sink-1' },
  };
  let defaultSink = sink.name;
  let inputs = initial;
  let reads = 0;
  const commands: string[][] = [];
  let onRead: ((count: number) => void) | undefined;
  const pactl = Layer.succeed(
    Pactl,
    Pactl.of({
      run: (args) =>
        Effect.sync(() => {
          if (args[0] === 'get-default-sink') return `${defaultSink}\n`;
          if (args[0] === '--format=json' && args[2] === 'sinks') return JSON.stringify([sink]);
          if (args[0] === '--format=json') {
            onRead?.(++reads);
            return JSON.stringify(inputs);
          }
          commands.push([...args]);
          if (args[0] === 'set-sink-mute') sink = { ...sink, mute: args[2] === '1' };
          if (args[0] === 'set-sink-volume')
            sink = {
              ...sink,
              volume: { left: { value: Number(args[2]) }, right: { value: Number(args[3]) } },
            };
          inputs = inputs.map((row) =>
            row.index !== Number(args[1])
              ? row
              : {
                  ...row,
                  ...(args[0] === 'set-sink-input-mute' ? { mute: args[2] === '1' } : {}),
                  ...(args[0] === 'set-sink-input-volume'
                    ? {
                        volume: Object.fromEntries(
                          Object.keys(row.volume).map((channel, i) => [
                            channel,
                            { value: Number(args[i + 2]) },
                          ]),
                        ),
                      }
                    : {}),
                },
          );
          return '';
        }),
    }),
  );
  return {
    commands,
    layer: serviceLayer.pipe(Layer.provide(pactl)),
    set: (next: typeof initial) => {
      inputs = next;
    },
    onRead: (callback: (count: number) => void) => {
      onRead = callback;
    },
    replaceSink: (name: string, serial: string) => {
      defaultSink = name;
      sink = { ...sink, name, properties: { 'object.serial': serial } };
    },
    removeDefault: () => {
      defaultSink = '';
    },
  };
};
const run = <A, E>(body: Effect.Effect<A, E, Audio>, f: ReturnType<typeof fixture>) =>
  Effect.runPromise(body.pipe(Effect.provide(f.layer)));
const app = (key: string): Application => ({
  key,
  name: key,
  streams: [],
  volume: 50,
  muted: false,
  mixedMute: false,
  paused: false,
});
const master: Master = {
  name: 'output',
  serial: 'sink-1',
  channels: [32768, 16384],
  volume: 50,
  muted: false,
};
const masterMock = { master: Effect.succeed(master), changeMaster: () => Effect.void };

test('playback decoding filters capture/system nodes, identifies Discord and groups app streams', async () => {
  const system = { ...input(3, 'system', [65536]), properties: {} };
  const capture = input(4, 'microphone', [65536]);
  capture.properties['media.class'] = 'Stream/Input/Audio';
  const apps = group(
    await Effect.runPromise(
      decodeInputs(
        JSON.stringify([
          input(1, 'Discord', [65536, 0]),
          input(2, 'Discord', [32768, 0], true),
          system,
          capture,
        ]),
      ),
    ),
  );
  assert.strictEqual(apps.length, 1);
  assert.strictEqual(apps[0]!.name, 'Discord');
  assert.strictEqual(apps[0]!.key, 'discord');
  assert.strictEqual(apps[0]!.streams.length, 2);
  assert.strictEqual(apps[0]!.volume, 100);
  assert.strictEqual(apps[0]!.mixedMute, true);
  for (const json of ['broken', '[{"index":1}]'])
    await expect(Effect.runPromise(decodeInputs(json))).rejects.toBeInstanceOf(AudioError);
});

test('volume changes preserve channel balance and relative levels across streams', async () => {
  const f = fixture([input(1, 'Discord', [65536, 0]), input(2, 'Discord', [32768, 0])]);
  await run(
    Effect.flatMap(Audio, (audio) => audio.change('discord', { delta: -2, toggles: 0 })),
    f,
  );
  assert.deepStrictEqual(f.commands, [
    ['set-sink-input-volume', '1', '64225', '0'],
    ['set-sink-input-volume', '2', '32113', '0'],
  ]);
});

test('click mutes a mixed group coherently, second click unmutes all streams', async () => {
  const f = fixture([input(1, 'Discord', [65536, 0]), input(2, 'Discord', [32768, 0], true)]);
  await run(
    Effect.gen(function* () {
      const audio = yield* Audio;
      yield* audio.change('discord', { delta: 0, toggles: 1 });
      assert.strictEqual((yield* audio.list)[0]!.muted, true);
      yield* audio.change('discord', { delta: 0, toggles: 1 });
    }),
    f,
  );
  assert.deepStrictEqual(
    f.commands.map((args) => args.slice(0, 3)),
    [
      ['set-sink-input-mute', '1', '1'],
      ['set-sink-input-mute', '2', '1'],
      ['set-sink-input-mute', '1', '0'],
      ['set-sink-input-mute', '2', '0'],
    ],
  );
});

test('disappearing or recycled stream indices never target a different application', async () => {
  const f = fixture([input(1, 'Spotify', [65536])]);
  f.onRead((count) => {
    if (count === 2) f.set([input(1, 'Discord', [65536], false, 'new')]);
  });
  await run(
    Effect.gen(function* () {
      const audio = yield* Audio;
      yield* audio.change('spotify', { delta: 2, toggles: 1 });
      yield* audio.change('missing', { delta: 2, toggles: 1 });
    }),
    f,
  );
  assert.deepStrictEqual(f.commands, []);
});

test('app volume rises above 100%, rises from silence, and preserves mute', async () => {
  const f = fixture([input(1, 'Spotify', [0, 0], true)]);
  await run(
    Effect.gen(function* () {
      const audio = yield* Audio;
      yield* audio.change('spotify', { delta: 2, toggles: 0 });
      assert.strictEqual((yield* audio.list)[0]!.muted, true);
      yield* audio.change('spotify', { delta: 1000, toggles: 0 });
    }),
    f,
  );
  assert.deepStrictEqual(f.commands, [
    ['set-sink-input-volume', '1', '1311', '1311'],
    ['set-sink-input-volume', '1', '131072', '131072'],
  ]);
  f.set([input(1, 'Spotify', [98304])]);
  await run(
    Effect.flatMap(Audio, (audio) => audio.change('spotify', { delta: 2, toggles: 0 })),
    f,
  );
  assert.strictEqual(f.commands.at(-1)![2], '99615');
  await run(
    Effect.flatMap(Audio, (audio) => audio.change('spotify', { delta: -10, toggles: 0 })),
    f,
  );
  assert.strictEqual(f.commands.at(-1)![2], '93061');
});

test('applications clamp at 200% and Master at 150%, retaining protocol bounds and channel balance', async () => {
  const f = fixture([input(1, 'Spotify', [65536, 32768])]);
  await run(
    Effect.gen(function* () {
      const audio = yield* Audio;
      yield* audio.change('spotify', { delta: Number.MAX_VALUE, toggles: 0 });
      assert.strictEqual((yield* audio.list)[0]!.volume, MAX_VOLUME_PERCENT);
      const target = yield* audio.master;
      assert.ok(target);
      yield* audio.changeMaster(target, { delta: 100, toggles: 0 });
      assert.strictEqual((yield* audio.master)!.volume, 150);
      yield* audio.changeMaster(target, { delta: Number.MAX_VALUE, toggles: 0 });
      assert.strictEqual((yield* audio.master)!.volume, MAX_MASTER_VOLUME_PERCENT);
    }),
    f,
  );
  assert.deepStrictEqual(f.commands, [
    ['set-sink-input-volume', '1', '131072', '65536'],
    ['set-sink-volume', 'output', '98304', '49152'],
    ['set-sink-volume', 'output', '98304', '49152'],
  ]);
  await expect(
    Effect.runPromise(decodeInputs(JSON.stringify([input(1, 'bad', [PULSE_VOLUME_MAX + 1])]))),
  ).rejects.toBeInstanceOf(AudioError);
  await expect(
    Effect.runPromise(
      decodeSinks(
        JSON.stringify([
          {
            name: 'bad',
            mute: false,
            volume: { mono: { value: PULSE_VOLUME_MAX + 1 } },
            properties: {},
          },
        ]),
      ),
    ),
  ).rejects.toBeInstanceOf(AudioError);
});

test('mock audio uses the same separate app and Master caps, preserving mute', async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const audio = yield* Audio;
      yield* audio.change('spotify', { delta: 100, toggles: 0 });
      assert.strictEqual((yield* audio.list).find((app) => app.key === 'spotify')!.volume, 150);
      yield* audio.change('spotify', { delta: Number.MAX_VALUE, toggles: 0 });
      assert.strictEqual(
        (yield* audio.list).find((app) => app.key === 'spotify')!.volume,
        MAX_VOLUME_PERCENT,
      );
      const target = yield* audio.master;
      assert.ok(target);
      yield* audio.changeMaster(target, { delta: Number.MAX_VALUE, toggles: 1 });
      assert.strictEqual((yield* audio.master)!.volume, MAX_MASTER_VOLUME_PERCENT);
      assert.strictEqual((yield* audio.master)!.muted, true);
    }).pipe(Effect.provide(mockLayer)),
  );
});

test('percentage pixels progress through yellow, orange and red above nominal volume', async () => {
  assert.deepStrictEqual(volumeColor(100), [255, 255, 255]);
  assert.deepStrictEqual(volumeColor(150), [255, 145, 30]);
  assert.deepStrictEqual(volumeColor(200), [255, 55, 55]);
  assert.deepStrictEqual(volumeColor(MAX_VOLUME_PERCENT), volumeColor(200));
  assert.ok(volumeColor(101)[1] > volumeColor(125)[1]);
  assert.ok(volumeColor(175)[1] > volumeColor(200)[1]);
  for (const volume of [100, 101, 150, 200, MAX_VOLUME_PERCENT]) {
    const image = await Effect.runPromise(
      card({ width: 168, height: 100 }, { name: 'MASTER', volume, muted: false }, true),
    );
    const color = volumeColor(volume);
    let pixels = 0;
    for (let offset = image.width * 50 * 3; offset < image.data.length; offset += 3) {
      if (
        image.data[offset] === color[0] &&
        image.data[offset + 1] === color[1] &&
        image.data[offset + 2] === color[2]
      )
        pixels++;
    }
    assert.ok(pixels > 0, `percentage foreground at ${volume}%`);
  }
});

test('invalid changes fail without playback mutations', async () => {
  const f = fixture();
  for (const change of [
    { delta: NaN, toggles: 0 },
    { delta: 0, toggles: -1 },
  ]) {
    await expect(
      run(
        Effect.flatMap(Audio, (audio) => audio.change('spotify', change)),
        f,
      ),
    ).rejects.toBeInstanceOf(AudioError);
  }
  assert.deepStrictEqual(f.commands, []);
});

test('app slots compact left while preserving relative order and append new applications', () => {
  assert.deepStrictEqual(assign(['a', 'b', 'c'], [app('c'), app('a'), app('d')]), ['a', 'c', 'd']);
  assert.deepStrictEqual(assign(['a', 'b', 'c'], [app('c'), app('b')]), ['b', 'c']);
  assert.deepStrictEqual(assign(['a', null, 'c'], [app('a')]), ['a']);
  assert.deepStrictEqual(assign(['a', null, 'c'], [app('c'), app('a')]), ['a', 'c']);
  assert.deepStrictEqual(assign(['a', 'b'], []), []);
  assert.deepStrictEqual(
    assign(['a', 'player'], [app('player'), app('a'), app('new')], new Set(['player'])),
    ['a', 'new', 'player'],
  );
  assert.strictEqual(
    assign(
      [],
      Array.from({ length: 8 }, (_, i) => app(`app${i}`)),
    ).length,
    8,
  );
});

test('LCD regions follow actual knob geometry and exactly cover the screen', () => {
  const dials: Control[] = Array.from({ length: 6 }, (_, index) => ({
    type: 'encoder',
    index,
    bounds: { x: 44 + index * 216, y: 0, width: 112, height: 112 },
  }));
  const lcd: Control = {
    type: 'lcd-segment',
    index: 0,
    pixelSize: { width: 1200, height: 100 },
    bounds: { x: 40, y: 0, width: 1200, height: 100 },
  };
  const slots = slotsFor(dials, lcd);
  assert.deepStrictEqual(
    slots.map((slot) => slot.width),
    [168, 216, 216, 216, 216, 168],
  );
  assert.strictEqual(slots.at(-1)!.x + slots.at(-1)!.width, 1200);
});

test('mixer startup only renders; batched ticks and clicks change the app actually displayed', async () => {
  const deck = Mock.make();
  const f = fixture();
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const mixer = yield* startMixer();
        assert.deepStrictEqual(f.commands, []);
        assert.strictEqual(deck.writes.length, 6);
        assert.deepStrictEqual((yield* mixer.state).assignments, ['discord', 'spotify']);
        yield* mixer.adjustDial(1, 1);
        yield* mixer.adjustDial(1, 2);
        yield* mixer.toggleDial(1);
        yield* mixer.flush;
        assert.deepStrictEqual(f.commands, [
          ['set-sink-input-volume', '7415', '17039', '17039'],
          ['set-sink-input-mute', '7415', '1'],
        ]);
        const writes = deck.writes.length;
        yield* mixer.refresh;
        assert.strictEqual(deck.writes.length, writes);
      }),
    ).pipe(Effect.provide(Layer.mergeAll(deck.layer(), f.layer))),
  );
  assert.strictEqual(deck.closes, 1);
});

it.effect(
  'mixer notifies only the displayed application and redraws adjustment feedback before audio flush',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const deck = Mock.make();
        const cards = yield* Cards.make;
        const notifications: Array<[string, { delta: number; toggles: number }]> = [];
        const changes: string[] = [];
        let track = true;
        yield* cards.register({
          id: 'feedback',
          matches: () => true,
          frame: (_, size) =>
            Effect.succeed(
              track ? { stamp: 'track', draw: Image.solid(size, [17, 23, 31]) } : undefined,
            ),
          onAdjust: (app, change) =>
            Effect.sync(() => {
              notifications.push([app.key, change]);
              track = false;
            }),
        });
        yield* Effect.gen(function* () {
          const mixer = yield* startMixer();
          const initialWrites = deck.writes.length;
          yield* mixer.adjustDial(0, 1);
          assert.deepStrictEqual(notifications, [['player', { delta: 2, toggles: 0 }]]);
          assert.strictEqual(deck.writes.length, initialWrites);
          yield* mixer.redraw;
          assert.strictEqual(deck.writes.length, initialWrites + 1);
          assert.deepStrictEqual(changes, []);
          yield* mixer.adjustDial(1, 1);
          yield* mixer.adjustDial(5, 1);
          assert.strictEqual(notifications.length, 1);
          yield* mixer.flush;
          assert.deepStrictEqual(changes, ['player']);
        }).pipe(
          Effect.provideService(Cards.MixerCards, cards),
          Effect.provide(
            Layer.mergeAll(
              deck.layer(),
              AudioModule.makeLayer({
                list: Effect.succeed([app('player')]),
                change: (key) =>
                  Effect.sync(() => {
                    changes.push(key);
                  }),
                ...masterMock,
              }),
            ),
          ),
        );
      }),
    ),
);

it.effect(
  'expanded cards use only empty slots and clear covered pixels when shrinking or receiving a new app',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const deck = Mock.make();
        const cards = yield* Cards.make;
        let track = true;
        let applications = [app('player')];
        yield* cards.register({
          id: 'wide',
          matches: (app) => app.key === 'player',
          expandIntoEmpty: true,
          placement: 'last',
          frame: (_, size) =>
            Effect.succeed(
              track
                ? { stamp: `wide/${size.width}`, draw: Image.solid(size, [17, 23, 31]) }
                : undefined,
            ),
          onAdjust: () =>
            Effect.sync(() => {
              track = false;
            }),
        });
        yield* Effect.gen(function* () {
          const mixer = yield* startMixer();
          const master = (yield* mixer.regions).at(-1)!;
          assert.strictEqual((yield* mixer.regions).length, 2);
          assert.strictEqual((yield* mixer.regions)[0]!.width, master.x);
          const expandedWrites = deck.writes.length;
          yield* mixer.adjustDial(0, 1);
          yield* mixer.redraw;
          const normal = yield* mixer.regions;
          assert.strictEqual(normal.length, 6);
          assert.strictEqual(deck.writes.length, expandedWrites + 5); // Gauge plus four cleared empty slots, no Master rewrite.
          track = true;
          yield* mixer.refresh;
          assert.strictEqual((yield* mixer.regions).length, 2);
          applications = [app('player'), app('other')];
          yield* mixer.refresh;
          assert.deepStrictEqual((yield* mixer.state).assignments, ['other', 'player']);
          const positioned = yield* mixer.regions;
          assert.strictEqual(positioned.length, 3);
          assert.strictEqual(positioned[0]!.width, normal[0]!.width);
          assert.strictEqual(positioned[1]!.width, master.x - positioned[1]!.x);
          yield* mixer.adjustDial(1, 1);
          yield* mixer.redraw;
          assert.deepStrictEqual((yield* mixer.state).assignments, ['other', 'player']);
          assert.strictEqual((yield* mixer.regions).length, 6);
          track = true;
          applications = [app('player')];
          yield* mixer.refresh;
          assert.strictEqual((yield* mixer.regions)[0]!.width, master.x);
          assert.deepStrictEqual((yield* mixer.regions).at(-1), master);
        }).pipe(
          Effect.provideService(Cards.MixerCards, cards),
          Effect.provide(
            Layer.mergeAll(
              deck.layer(),
              AudioModule.makeLayer({
                list: Effect.sync(() => applications),
                change: () => Effect.void,
                ...masterMock,
              }),
            ),
          ),
        );
      }),
    ),
);

it.effect(
  'retained cards preserve a live application alias, slot and volume when its stream disappears',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const deck = Mock.make();
        const cards = yield* Cards.make;
        let applications: ReadonlyArray<Application> = [app('com.spotify.client')];
        yield* cards.register({
          id: 'player',
          matches: () => true,
          retain: Effect.succeed([
            { key: 'spotify', name: 'Spotify', aliases: ['com.spotify.client'] },
          ]),
          frame: () => Effect.succeed(undefined),
        });
        yield* Effect.gen(function* () {
          const mixer = yield* startMixer();
          assert.deepStrictEqual((yield* mixer.state).assignments, ['com.spotify.client']);
          applications = [];
          yield* mixer.refresh;
          const retained = yield* mixer.state;
          assert.deepStrictEqual(retained.assignments, ['com.spotify.client']);
          assert.strictEqual(retained.apps[0]!.key, 'com.spotify.client');
          assert.strictEqual(retained.apps[0]!.volume, 50);
          assert.strictEqual(retained.apps[0]!.paused, true);
          assert.deepStrictEqual(retained.apps[0]!.streams, []);
        }).pipe(
          Effect.provideService(Cards.MixerCards, cards),
          Effect.provide(
            Layer.mergeAll(
              deck.layer(),
              AudioModule.makeLayer({
                list: Effect.sync(() => applications),
                change: () => Effect.void,
                ...masterMock,
              }),
            ),
          ),
        );
      }),
    ),
);

test('removing the first app compacts pages, redraws moved cards and keeps queued controls bound to their app', async () => {
  const deck = Mock.make();
  const inputs = Array.from({ length: 6 }, (_, i) => input(i + 1, `App${i}`, [32768]));
  const f = fixture(inputs);
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const mixer = yield* startMixer();
        yield* mixer.adjustDial(1, 1); // Queued for App1 before it changes physical slot.
        yield* mixer.changePage(1);
        f.set(inputs.slice(1));
        yield* mixer.refresh;
        const view = yield* mixer.state;
        assert.deepStrictEqual(view.assignments, ['app1', 'app2', 'app3', 'app4', 'app5']);
        assert.strictEqual(view.page, 0);
        assert.strictEqual(view.master?.name, 'output');
        assert.deepStrictEqual(f.commands, []);
        const writes = deck.writes.length;
        yield* mixer.adjustDial(0, 1);
        yield* mixer.toggleDial(0);
        yield* mixer.flush;
        assert.deepStrictEqual(f.commands, [
          ['set-sink-input-volume', '2', '35389'],
          ['set-sink-input-mute', '2', '1'],
        ]);
        assert.ok(deck.writes.length > writes);
        assert.deepStrictEqual((yield* mixer.state).assignments, view.assignments);
      }),
    ).pipe(Effect.provide(Layer.mergeAll(deck.layer(), f.layer))),
  );
});

test('page changes keep pending actions bound to the original app and empty dials do nothing', async () => {
  const deck = Mock.make();
  const f = fixture(Array.from({ length: 8 }, (_, i) => input(i + 1, `App${i}`, [32768])));
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const mixer = yield* startMixer();
        yield* mixer.adjustDial(0, 1);
        yield* mixer.changePage(1);
        yield* mixer.toggleDial(0);
        yield* mixer.toggleDial(4);
        yield* mixer.flush;
        assert.deepStrictEqual(f.commands, [
          ['set-sink-input-volume', '1', '34079'],
          ['set-sink-input-mute', '6', '1'],
        ]);
        assert.strictEqual((yield* mixer.state).page, 1);
      }),
    ).pipe(Effect.provide(Layer.mergeAll(deck.layer(), f.layer))),
  );
});

test('offline feedback disables actions and reconnect restores the existing app slots', async () => {
  const deck = Mock.make();
  let offline = false;
  let changes = 0;
  const audio = AudioModule.makeLayer({
    ...masterMock,
    list: Effect.suspend(() =>
      offline
        ? Effect.fail(new AudioError({ operation: 'list', message: 'offline' }))
        : Effect.succeed([app('spotify')]),
    ),
    change: () =>
      Effect.sync(() => {
        changes++;
      }),
  });
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const mixer = yield* startMixer();
        offline = true;
        yield* mixer.refresh;
        assert.strictEqual((yield* mixer.state).online, false);
        yield* mixer.adjustDial(0, 1);
        yield* mixer.toggleDial(0);
        yield* mixer.flush;
        assert.strictEqual(changes, 0);
        offline = false;
        yield* mixer.refresh;
        assert.deepStrictEqual((yield* mixer.state).assignments, ['spotify']);
      }),
    ).pipe(Effect.provide(Layer.mergeAll(deck.layer(), audio))),
  );
});

test('encoder events route through the Effect binding runner', async () => {
  const deck = Mock.make();
  const written = Deferred.makeUnsafe<void>();
  let changeKey = '';
  const audio = AudioModule.makeLayer({
    ...masterMock,
    list: Effect.succeed([app('spotify')]),
    change: (key) =>
      Effect.sync(() => {
        changeKey = key;
      }).pipe(Effect.andThen(Deferred.succeed(written, undefined)), Effect.asVoid),
  });
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const mixer = yield* startMixer({ flushMillis: 1 });
        const fiber = yield* Effect.forkScoped(mixer.run);
        yield* deck.emit({ _tag: 'DialRotate', dial: 0, delta: 1 });
        yield* Deferred.await(written);
        yield* Fiber.interrupt(fiber);
      }),
    ).pipe(Effect.provide(Layer.mergeAll(deck.layer(), audio)), Effect.timeout('2 seconds')),
  );
  assert.strictEqual(changeKey, 'spotify');
  assert.strictEqual(deck.closes, 1);
});

it.live(
  'service observations update mixer values, plugin callbacks and the UI without a knob event',
  () => {
    const deck = Mock.make();
    const f = fixture([input(1, 'Spotifast', [32768])]);
    return Effect.scoped(
      Effect.gen(function* () {
        const cards = yield* Cards.make;
        const changes: Array<{ volume: number; muted: boolean; previous: number }> = [];
        yield* cards.register({
          id: 'observed-player',
          matches: (application) => application.key === 'spotifast',
          onChange: (application, before) =>
            Effect.sync(() => {
              changes.push({
                volume: application.volume,
                muted: application.muted,
                previous: before.volume,
              });
            }),
          frame: () => Effect.succeed(undefined),
        });
        yield* Effect.gen(function* () {
          const mixer = yield* startMixer({ refreshMillis: 60_000 });
          yield* mixer.run.pipe(Effect.forkScoped);
          const writes = deck.writes.length;
          f.set([input(1, 'Spotifast', [81920], true)]);
          yield* Effect.gen(function* () {
            const current = (yield* mixer.state).apps[0];
            if (current?.volume !== 125 || !current.muted)
              return yield* Effect.fail('Waiting for service observation');
          }).pipe(Effect.retry(Schedule.spaced(10)), Effect.timeout('2 seconds'));
          assert.deepStrictEqual(changes, [{ volume: 125, muted: true, previous: 50 }]);
          assert.deepStrictEqual(f.commands, []);
          assert.ok(deck.writes.length > writes);
          yield* mixer.refresh;
          assert.strictEqual(changes.length, 1);
          const scene = yield* mixer.scene;
          expect(scene?.[0]?.view.data).toMatchObject({
            online: true,
            title: null,
            app: { name: 'Spotifast', volume: 125, muted: true, mixedMute: false },
          });
          // The next local adjustment starts from the external value, not a stale UI value.
          yield* mixer.adjustDial(0, 1);
          yield* mixer.flush;
          assert.ok(Math.abs(((yield* mixer.state).apps[0]?.volume ?? 0) - 127) < 0.01);
          assert.strictEqual((yield* mixer.state).apps[0]?.muted, true);
        }).pipe(Effect.provideService(Cards.MixerCards, cards));
      }),
    ).pipe(Effect.provide(Layer.mergeAll(deck.layer(), f.layer)));
  },
);

it.live('CLI mock mixer runs with neither pactl nor native HID available and validates step', () =>
  Effect.gen(function* () {
    const env = { PATH: '/nonexistent', LD_LIBRARY_PATH: '' };
    // Allow cold Layer / renderer initialization before the timed CLI stops.
    const result = yield* cli(['mixer', '--mock', '--duration', '1'], env);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /mixer-ready/);
    for (const step of ['0', 'NaN', '21']) {
      const invalid = yield* cli(['mixer', '--mock', '--step', step], env);
      assert.strictEqual(invalid.status, 1);
    }
  }).pipe(Effect.provide(NodeServices.layer)),
);

test('master controls only the default sink, preserves balance, and leaves app volumes alone', async () => {
  const f = fixture();
  await run(
    Effect.gen(function* () {
      const audio = yield* Audio;
      const target = yield* audio.master;
      assert.ok(target);
      yield* audio.changeMaster(target, { delta: 2, toggles: 1 });
      const muted = yield* audio.master;
      assert.ok(muted);
      assert.strictEqual(muted.muted, true);
      yield* audio.changeMaster(muted, { delta: -2, toggles: 0 });
      assert.strictEqual((yield* audio.master)!.muted, true);
      yield* audio.changeMaster(muted, { delta: 0, toggles: 1 });
      assert.strictEqual((yield* audio.master)!.muted, false);
      assert.strictEqual(
        Math.round((yield* audio.list).find((app) => app.key === 'spotify')!.volume),
        20,
      );
    }),
    f,
  );
  assert.deepStrictEqual(f.commands, [
    ['set-sink-volume', 'output', '34079', '17039'],
    ['set-sink-mute', 'output', '1'],
    ['set-sink-volume', 'output', '32768', '16384'],
    ['set-sink-mute', 'output', '0'],
  ]);
});

test('pending master changes do not spill onto a different or recreated default sink', async () => {
  const f = fixture();
  await run(
    Effect.gen(function* () {
      const audio = yield* Audio;
      const previous = yield* audio.master;
      assert.ok(previous);
      for (const [name, serial] of [
        ['headphones', 'sink-2'],
        ['output', 'sink-3'],
      ]) {
        f.replaceSink(name!, serial!);
        yield* audio.changeMaster(previous, { delta: 2, toggles: 1 });
      }
      f.removeDefault();
      assert.strictEqual(yield* audio.master, undefined);
      yield* audio.changeMaster(previous, { delta: 2, toggles: 1 });
    }),
    f,
  );
  assert.deepStrictEqual(f.commands, []);
});

test('rightmost dial is reserved for master across pages; app pagination uses five slots', async () => {
  const deck = Mock.make();
  const f = fixture(Array.from({ length: 6 }, (_, i) => input(i + 1, `App${i}`, [32768])));
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const mixer = yield* startMixer();
        assert.deepStrictEqual(f.commands, []);
        yield* mixer.adjustDial(5, 1);
        yield* mixer.changePage(1);
        yield* mixer.toggleDial(5);
        yield* mixer.toggleDial(0);
        yield* mixer.flush;
        assert.deepStrictEqual(f.commands, [
          ['set-sink-input-mute', '6', '1'],
          ['set-sink-volume', 'output', '34079', '17039'],
          ['set-sink-mute', 'output', '1'],
        ]);
        assert.strictEqual((yield* mixer.state).page, 1);
        assert.strictEqual((yield* mixer.state).master!.muted, true);
      }),
    ).pipe(Effect.provide(Layer.mergeAll(deck.layer(), f.layer))),
  );
});

test('master read failure disables its dial while app controls remain usable', async () => {
  const deck = Mock.make();
  let appChanges = 0;
  let masterChanges = 0;
  const audio = AudioModule.makeLayer({
    list: Effect.succeed([app('spotify')]),
    master: Effect.fail(new AudioError({ operation: 'master', message: 'unavailable' })),
    change: () =>
      Effect.sync(() => {
        appChanges++;
      }),
    changeMaster: () =>
      Effect.sync(() => {
        masterChanges++;
      }),
  });
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const mixer = yield* startMixer();
        yield* mixer.toggleDial(5);
        yield* mixer.adjustDial(5, 1);
        yield* mixer.toggleDial(0);
        yield* mixer.flush;
        assert.strictEqual(appChanges, 1);
        assert.strictEqual(masterChanges, 0);
        assert.strictEqual((yield* mixer.state).masterOnline, false);
      }),
    ).pipe(Effect.provide(Layer.mergeAll(deck.layer(), audio))),
  );
});
