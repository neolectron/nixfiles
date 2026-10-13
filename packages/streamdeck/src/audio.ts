import { Context, Data, Effect, Layer, Schema, Semaphore, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

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
export class Audio extends Context.Service<Audio, {
  readonly list: Effect.Effect<ReadonlyArray<Application>, AudioError>;
  readonly change: (key: string, change: Change) => Effect.Effect<void, AudioError>;
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

const SinkInputs = Schema.Array(Schema.Struct({
  index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  mute: Schema.Boolean,
  corked: Schema.Boolean,
  volume: Schema.Record(Schema.String, Schema.Struct({ value: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) })),
  properties: Schema.Record(Schema.String, Schema.String),
}));
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
    volume: Math.max(...members.flatMap((stream) => stream.channels)) / 65536 * 100,
    muted: members.every((stream) => stream.muted), mixedMute: members.some((stream) => stream.muted) && !members.every((stream) => stream.muted),
    paused: members.every((stream) => stream.paused),
  })).sort((a, b) => a.name.localeCompare(b.name));
};

export const serviceLayer = Layer.effect(Audio, Effect.gen(function*() {
  const pactl = yield* Pactl;
  const lock = yield* Semaphore.make(1);
  const read = pactl.run(['--format=json', 'list', 'sink-inputs']).pipe(Effect.flatMap(decodeInputs));
  return Audio.of({
    list: Effect.map(read, group),
    change: (key, change) => Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
      if (!Number.isFinite(change.delta) || !Number.isSafeInteger(change.toggles) || change.toggles < 0) return yield* Effect.fail(new AudioError({ operation: 'change', message: 'Invalid audio change.' }));
      const app = group(yield* read).find((candidate) => candidate.key === key);
      if (!app) return; // App disappeared; never substitute another knob's new occupant.
      const target = change.delta > 0 ? Math.min(Math.max(100, app.volume), app.volume + change.delta) : Math.max(0, app.volume + change.delta);
      for (const stream of app.streams) {
        // Revalidate serial and application immediately before using the Pulse index.
        const fresh = (yield* read).find((candidate) => candidate.index === stream.index && candidate.serial === stream.serial && candidate.app === key);
        if (!fresh) continue;
        if (change.delta !== 0) {
          const channels = fresh.channels.map((volume) => String(Math.round(app.volume > 0 ? volume * target / app.volume : target / 100 * 65536)));
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
  let streams: PlaybackStream[] = [
    { index: 1, serial: '1', app: 'discord', name: 'Discord', channels: [65536, 0], muted: false, paused: false },
    { index: 2, serial: '2', app: 'spotify', name: 'Spotify', channels: [32768, 32768], muted: false, paused: false },
  ];
  return Audio.of({ list: Effect.sync(() => group(streams)), change: (key, change) => Effect.sync(() => {
    const app = group(streams).find((candidate) => candidate.key === key); if (!app) return;
    const target = Math.max(0, Math.min(100, app.volume + change.delta));
    streams = streams.map((stream) => stream.app !== key ? stream : { ...stream,
      channels: change.delta ? stream.channels.map((volume) => Math.round(app.volume ? volume * target / app.volume : target / 100 * 65536)) : stream.channels,
      muted: change.toggles % 2 ? !app.muted : stream.muted,
    });
  }) });
}));
