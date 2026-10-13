import { Context, Data, Effect, Layer, Schema, Semaphore, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

/** PulseAudio 17 / PipeWire-Pulse: 100% = 0x10000; largest valid volume = UINT32_MAX / 2. */
export const PULSE_VOLUME_NORM = 0x10000;
export const PULSE_VOLUME_MAX = 0x7fffffff;
/** Mixer limit requested by Manuel; protocol validation keeps its independent raw bound. */
export const MAX_VOLUME_PERCENT = 200;
/** Default output ceiling matches Noctalia's supported overdrive. */
export const MAX_MASTER_VOLUME_PERCENT = 150;

export class AudioError extends Data.TaggedError('AudioError')<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}
export interface PlaybackStream {
  readonly index: number;
  readonly serial: string;
  readonly app: string;
  readonly name: string;
  readonly channels: ReadonlyArray<number>;
  readonly muted: boolean;
  readonly paused: boolean;
}
export interface Application {
  readonly key: string;
  readonly name: string;
  readonly streams: ReadonlyArray<PlaybackStream>;
  readonly volume: number;
  readonly muted: boolean;
  readonly mixedMute: boolean;
  readonly paused: boolean;
}
export interface Change { readonly delta: number; readonly toggles: number }
export interface Master {
  readonly name: string;
  readonly serial: string;
  readonly channels: ReadonlyArray<number>;
  readonly volume: number;
  readonly muted: boolean;
}
export class Audio extends Context.Service<Audio, {
  readonly list: Effect.Effect<ReadonlyArray<Application>, AudioError>;
  readonly change: (key: string, change: Change) => Effect.Effect<void, AudioError>;
  readonly master: Effect.Effect<Master | undefined, AudioError>;
  readonly changeMaster: (target: Master, change: Change) => Effect.Effect<void, AudioError>;
}>()('@nixfiles/streamdeck/Audio') {}

/** Testable process boundary; the production runner always uses literal argv. */
export class Pactl extends Context.Service<Pactl, {
  readonly run: (args: ReadonlyArray<string>) => Effect.Effect<string, AudioError>;
}>()('@nixfiles/streamdeck/Pactl') {}
export const pactlLayer = Layer.effect(Pactl, Effect.gen(function*() {
  const processes = yield* ChildProcessSpawner.ChildProcessSpawner;
  return Pactl.of({ run: (args) => Effect.scoped(Effect.gen(function*() {
    const handle = yield* processes.spawn(ChildProcess.make('pactl', args, { env: { LC_ALL: 'C' }, extendEnv: true }));
    const [out, err, code] = yield* Effect.all([
      Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr)), handle.exitCode,
    ], { concurrency: 'unbounded' });
    if (code !== 0) return yield* Effect.fail(new AudioError({ operation: args[0] ?? 'pactl', message: err.trim() || `pactl exited ${code}` }));
    return out;
  })).pipe(Effect.timeout('2 seconds'), Effect.mapError((cause) => cause instanceof AudioError ? cause : new AudioError({ operation: 'pactl', message: 'Audio command failed or timed out.', cause }))) });
}));

const ChannelVolume = Schema.Struct({ value: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(PULSE_VOLUME_MAX)) });
const SinkInputs = Schema.Array(Schema.Struct({
  index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  mute: Schema.Boolean,
  corked: Schema.Boolean,
  volume: Schema.Record(Schema.String, ChannelVolume),
  properties: Schema.Record(Schema.String, Schema.String),
}));
const Sinks = Schema.Array(Schema.Struct({
  name: Schema.String,
  mute: Schema.Boolean,
  volume: Schema.Record(Schema.String, ChannelVolume),
  properties: Schema.Record(Schema.String, Schema.String),
}));
export const decodeSinks = (json: string) => Effect.gen(function*() {
  const raw = yield* Effect.try({ try: () => JSON.parse(json) as unknown, catch: (cause) => new AudioError({ operation: 'decode', message: 'Invalid sink JSON.', cause }) });
  const sinks = yield* Schema.decodeUnknownEffect(Sinks)(raw).pipe(Effect.mapError((cause) => new AudioError({ operation: 'decode', message: 'Invalid sink data.', cause })));
  return sinks.flatMap((sink): Master[] => {
    const channels = Object.values(sink.volume).map((volume) => volume.value);
    return channels.length ? [{ name: sink.name, serial: sink.properties['object.serial'] ?? sink.name,
      channels, volume: Math.max(...channels) / PULSE_VOLUME_NORM * 100, muted: sink.mute }] : [];
  });
});
const validateChange = (change: Change) => Number.isFinite(change.delta) && Number.isSafeInteger(change.toggles) && change.toggles >= 0
  ? Effect.void : Effect.fail(new AudioError({ operation: 'change', message: 'Invalid audio change.' }));
const changedChannels = (channels: ReadonlyArray<number>, volume: number, delta: number, maximum = MAX_VOLUME_PERCENT) => {
  const target = Math.max(0, Math.min(maximum, volume + delta));
  return channels.map((value) => Math.max(0, Math.min(PULSE_VOLUME_MAX,
    Math.round(volume > 0 ? value * target / volume : target / 100 * PULSE_VOLUME_NORM))));
};
const cleanBinary = (binary: string) => binary.split('/').at(-1)!.replace(/^\./, '').replace(/-wrapped$/, '');
export const decodeInputs = (json: string) => Effect.gen(function*() {
  const raw = yield* Effect.try({ try: () => JSON.parse(json) as unknown, catch: (cause) => new AudioError({ operation: 'decode', message: 'Invalid audio JSON.', cause }) });
  const inputs = yield* Schema.decodeUnknownEffect(SinkInputs)(raw).pipe(Effect.mapError((cause) => new AudioError({ operation: 'decode', message: 'Invalid playback stream data.', cause })));
  return inputs.flatMap((input): PlaybackStream[] => {
    const props = input.properties;
    const appName = props['application.name']?.trim();
    const binary = props['application.process.binary'] ? cleanBinary(props['application.process.binary']) : '';
    // Physical sinks, monitor/capture streams and system loopback nodes are not apps.
    if ((!appName && !binary) || (props['media.class'] && props['media.class'] !== 'Stream/Output/Audio')) return [];
    const identity = props['application.id'] || binary || appName!;
    const name = appName && !/^(webrtc|chromium input|google chrome input)/i.test(appName) ? appName : binary || appName!;
    const channels = Object.values(input.volume).map((volume) => volume.value);
    if (!channels.length) return [];
    return [{ index: input.index, serial: props['object.serial'] ?? String(input.index), app: identity.toLowerCase(),
      name: name.charAt(0).toUpperCase() + name.slice(1), channels, muted: input.mute, paused: input.corked }];
  });
});
export const group = (streams: ReadonlyArray<PlaybackStream>): ReadonlyArray<Application> => {
  const groups = new Map<string, PlaybackStream[]>();
  for (const stream of streams) groups.set(stream.app, [...(groups.get(stream.app) ?? []), stream]);
  return [...groups].map(([key, members]) => ({ key, name: members[0]!.name, streams: members,
    volume: Math.max(...members.flatMap((stream) => stream.channels)) / PULSE_VOLUME_NORM * 100,
    muted: members.every((stream) => stream.muted), mixedMute: members.some((stream) => stream.muted) && !members.every((stream) => stream.muted),
    paused: members.every((stream) => stream.paused),
  })).sort((a, b) => a.name.localeCompare(b.name));
};

export const serviceLayer = Layer.effect(Audio, Effect.gen(function*() {
  const pactl = yield* Pactl;
  const lock = yield* Semaphore.make(1);
  const read = pactl.run(['--format=json', 'list', 'sink-inputs']).pipe(Effect.flatMap(decodeInputs));
  const readMaster = Effect.gen(function*() {
    const name = (yield* pactl.run(['get-default-sink'])).trim();
    if (!name) return undefined;
    const sinks = yield* pactl.run(['--format=json', 'list', 'sinks']).pipe(Effect.flatMap(decodeSinks));
    return sinks.find((sink) => sink.name === name);
  });
  return Audio.of({
    list: Effect.map(read, group),
    master: readMaster,
    changeMaster: (target, change) => Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
      yield* validateChange(change);
      const fresh = yield* readMaster;
      // A pending gesture must not spill onto a newly selected/recreated output.
      if (!fresh || fresh.name !== target.name || fresh.serial !== target.serial) return;
      if (change.delta !== 0) yield* pactl.run(['set-sink-volume', fresh.name, ...changedChannels(fresh.channels, fresh.volume, change.delta, MAX_MASTER_VOLUME_PERCENT).map(String)]);
      if (change.toggles % 2) yield* pactl.run(['set-sink-mute', fresh.name, fresh.muted ? '0' : '1']);
    })),
    change: (key, change) => Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
      yield* validateChange(change);
      const app = group(yield* read).find((candidate) => candidate.key === key);
      if (!app) return; // App disappeared; never substitute another knob's new occupant.
      for (const stream of app.streams) {
        // Revalidate serial and application immediately before using the Pulse index.
        const fresh = (yield* read).find((candidate) => candidate.index === stream.index && candidate.serial === stream.serial && candidate.app === key);
        if (!fresh) continue;
        if (change.delta !== 0) {
          const channels = changedChannels(fresh.channels, app.volume, change.delta).map(String);
          yield* pactl.run(['set-sink-input-volume', String(fresh.index), ...channels]);
        }
        if (change.toggles % 2) yield* pactl.run(['set-sink-input-mute', String(fresh.index), app.muted ? '0' : '1']);
      }
    })),
  });
}));
export const layer = serviceLayer.pipe(Layer.provide(pactlLayer));

/** Entirely inert audio fixture for the CLI's --mock mode. */
export const mockLayer = Layer.effect(Audio, Effect.sync(() => {
  let master: Master = { name: 'mock-output', serial: 'mock-output-1', channels: [32768, 32768], volume: 50, muted: false };
  let streams: PlaybackStream[] = [
    { index: 1, serial: '1', app: 'discord', name: 'Discord', channels: [65536, 0], muted: false, paused: false },
    { index: 2, serial: '2', app: 'spotify', name: 'Spotify', channels: [32768, 32768], muted: false, paused: false },
  ];
  return Audio.of({ list: Effect.sync(() => group(streams)), master: Effect.sync(() => master),
    changeMaster: (target, change) => validateChange(change).pipe(Effect.andThen(Effect.sync(() => {
      if (target.name !== master.name || target.serial !== master.serial) return;
      const channels = change.delta ? changedChannels(master.channels, master.volume, change.delta, MAX_MASTER_VOLUME_PERCENT) : master.channels;
      master = { ...master, channels, volume: Math.max(...channels) / PULSE_VOLUME_NORM * 100, muted: change.toggles % 2 ? !master.muted : master.muted };
    }))), change: (key, change) => validateChange(change).pipe(Effect.andThen(Effect.sync(() => {
    const app = group(streams).find((candidate) => candidate.key === key); if (!app) return;
    streams = streams.map((stream) => stream.app !== key ? stream : { ...stream,
      channels: change.delta ? changedChannels(stream.channels, app.volume, change.delta) : stream.channels,
      muted: change.toggles % 2 ? !app.muted : stream.muted,
    });
  }))) });
}));
