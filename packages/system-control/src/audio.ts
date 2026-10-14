import { invariant } from './errors.ts';
import { Context, Data, Effect, Layer, Schema, Semaphore, Stream } from 'effect';
import * as State from './state.ts';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import * as Limits from './audio-limits.ts';
/** PulseAudio 17 / PipeWire-Pulse: 100% = 0x10000; largest valid volume = UINT32_MAX / 2. */
export const PULSE_VOLUME_NORM = 0x10000;
export const PULSE_VOLUME_MAX = 0x7fffffff;
/** Mixer limit requested by Manuel; protocol validation keeps its independent raw bound. */
export const MAX_VOLUME_PERCENT = Limits.MAX_VOLUME_PERCENT;
/** Default output ceiling matches Noctalia's supported overdrive. */
export const MAX_MASTER_VOLUME_PERCENT = Limits.MAX_MASTER_VOLUME_PERCENT;
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
export interface Change {
  readonly delta: number;
  readonly toggles: number;
}
export interface Master {
  readonly name: string;
  readonly serial: string;
  readonly channels: ReadonlyArray<number>;
  readonly volume: number;
  readonly muted: boolean;
}
export class AudioBackend extends Context.Service<
  AudioBackend,
  {
    readonly list: Effect.Effect<ReadonlyArray<Application>, AudioError>;
    readonly change: (key: string, change: Change) => Effect.Effect<void, AudioError>;
    readonly setApplication?: (
      key: string,
      volume?: number,
      muted?: boolean,
    ) => Effect.Effect<void, AudioError>;
    readonly master: Effect.Effect<Master | undefined, AudioError>;
    readonly changeMaster: (target: Master, change: Change) => Effect.Effect<void, AudioError>;
  }
>()('@nixfiles/system-control/AudioBackend') {}
/** Testable process boundary; the production runner always uses literal argv. */
export class Pactl extends Context.Service<
  Pactl,
  {
    readonly run: (args: ReadonlyArray<string>) => Effect.Effect<string, AudioError>;
  }
>()('@nixfiles/system-control/Pactl') {}
export const pactlLayer = Layer.effect(
  Pactl,
  Effect.gen(function* () {
    const processes = yield* ChildProcessSpawner.ChildProcessSpawner;
    return Pactl.of({
      run: (args) =>
        Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* processes.spawn(
              ChildProcess.make('pactl', args, { env: { LC_ALL: 'C' }, extendEnv: true }),
            );
            const [out, err, code] = yield* Effect.all(
              [
                Stream.mkString(Stream.decodeText(handle.stdout)),
                Stream.mkString(Stream.decodeText(handle.stderr)),
                handle.exitCode,
              ],
              { concurrency: 'unbounded' },
            );
            if (code !== 0)
              return yield* Effect.fail(
                new AudioError({
                  operation: args[0] ?? 'pactl',
                  message: err.trim() || `pactl exited ${code}`,
                }),
              );
            return out;
          }),
        ).pipe(
          Effect.timeout('2 seconds'),
          Effect.mapError((cause) =>
            cause instanceof AudioError
              ? cause
              : new AudioError({
                  operation: 'pactl',
                  message: 'Audio command failed or timed out.',
                  cause,
                }),
          ),
        ),
    });
  }),
);
const ChannelVolume = Schema.Struct({
  value: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(PULSE_VOLUME_MAX),
  ),
});
const SinkInputs = Schema.Array(
  Schema.Struct({
    index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    mute: Schema.Boolean,
    corked: Schema.Boolean,
    volume: Schema.Record(Schema.String, ChannelVolume),
    properties: Schema.Record(Schema.String, Schema.String),
  }),
);
const Sinks = Schema.Array(
  Schema.Struct({
    name: Schema.String,
    mute: Schema.Boolean,
    volume: Schema.Record(Schema.String, ChannelVolume),
    properties: Schema.Record(Schema.String, Schema.String),
  }),
);
export const decodeSinks = (json: string) =>
  Effect.gen(function* () {
    const raw = yield* Effect.try({
      try: () => JSON.parse(json) as unknown,
      catch: (cause) =>
        new AudioError({ operation: 'decode', message: 'Invalid sink JSON.', cause }),
    });
    const sinks = yield* Schema.decodeUnknownEffect(Sinks)(raw).pipe(
      Effect.mapError(
        (cause) => new AudioError({ operation: 'decode', message: 'Invalid sink data.', cause }),
      ),
    );
    return sinks.flatMap((sink): Master[] => {
      const channels = Object.values(sink.volume).map((volume) => volume.value);
      return channels.length
        ? [
            {
              name: sink.name,
              serial: sink.properties['object.serial'] ?? sink.name,
              channels,
              volume: (Math.max(...channels) / PULSE_VOLUME_NORM) * 100,
              muted: sink.mute,
            },
          ]
        : [];
    });
  });
const validateChange = (change: Change) =>
  Number.isFinite(change.delta) && Number.isSafeInteger(change.toggles) && change.toggles >= 0
    ? Effect.void
    : Effect.fail(new AudioError({ operation: 'change', message: 'Invalid audio change.' }));
const changedChannels = (
  channels: ReadonlyArray<number>,
  volume: number,
  delta: number,
  maximum = MAX_VOLUME_PERCENT,
) => {
  const target = Math.max(0, Math.min(maximum, volume + delta));
  return channels.map((value) =>
    Math.max(
      0,
      Math.min(
        PULSE_VOLUME_MAX,
        Math.round(volume > 0 ? (value * target) / volume : (target / 100) * PULSE_VOLUME_NORM),
      ),
    ),
  );
};
const cleanBinary = (binary: string) =>
  invariant(binary.split('/').at(-1), 'audio')
    .replace(/^\./, '')
    .replace(/-wrapped$/, '');
export const decodeInputs = (json: string) =>
  Effect.gen(function* () {
    const raw = yield* Effect.try({
      try: () => JSON.parse(json) as unknown,
      catch: (cause) =>
        new AudioError({ operation: 'decode', message: 'Invalid audio JSON.', cause }),
    });
    const inputs = yield* Schema.decodeUnknownEffect(SinkInputs)(raw).pipe(
      Effect.mapError(
        (cause) =>
          new AudioError({ operation: 'decode', message: 'Invalid playback stream data.', cause }),
      ),
    );
    return inputs.flatMap((input): PlaybackStream[] => {
      const props = input.properties;
      const appName = props['application.name']?.trim();
      const binary = props['application.process.binary']
        ? cleanBinary(props['application.process.binary'])
        : '';
      // Physical sinks, monitor/capture streams and system loopback nodes are not apps.
      if (
        (!appName && !binary) ||
        (props['media.class'] && props['media.class'] !== 'Stream/Output/Audio')
      )
        return [];
      const identity = props['application.id'] || binary || invariant(appName, 'audio');
      const name =
        appName && !/^(webrtc|chromium input|google chrome input)/i.test(appName)
          ? appName
          : binary || invariant(appName, 'audio');
      const channels = Object.values(input.volume).map((volume) => volume.value);
      if (!channels.length) return [];
      return [
        {
          index: input.index,
          serial: props['object.serial'] ?? String(input.index),
          app: identity.toLowerCase(),
          name: name.charAt(0).toUpperCase() + name.slice(1),
          channels,
          muted: input.mute,
          paused: input.corked,
        },
      ];
    });
  });
export const group = (streams: ReadonlyArray<PlaybackStream>): ReadonlyArray<Application> => {
  const groups = new Map<string, PlaybackStream[]>();
  for (const stream of streams) groups.set(stream.app, [...(groups.get(stream.app) ?? []), stream]);
  return [...groups]
    .map(([key, members]) => ({
      key,
      name: invariant(members[0], 'audio').name,
      streams: members,
      volume: (Math.max(...members.flatMap((stream) => stream.channels)) / PULSE_VOLUME_NORM) * 100,
      muted: members.every((stream) => stream.muted),
      mixedMute: members.some((stream) => stream.muted) && !members.every((stream) => stream.muted),
      paused: members.every((stream) => stream.paused),
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
};
const backendLayer = Layer.effect(
  AudioBackend,
  Effect.gen(function* () {
    const pactl = yield* Pactl;
    const lock = yield* Semaphore.make(1);
    const read = pactl
      .run(['--format=json', 'list', 'sink-inputs'])
      .pipe(Effect.flatMap(decodeInputs));
    const readMaster = Effect.gen(function* () {
      const name = (yield* pactl.run(['get-default-sink'])).trim();
      if (!name) return undefined;
      const sinks = yield* pactl
        .run(['--format=json', 'list', 'sinks'])
        .pipe(Effect.flatMap(decodeSinks));
      return sinks.find((sink) => sink.name === name);
    });
    const updateApplication = (
      key: string,
      change: Change,
      absolute?: { volume?: number; muted?: boolean },
    ) =>
      Semaphore.withPermits(
        lock,
        1,
      )(
        Effect.gen(function* () {
          yield* validateChange(change);
          const app = group(yield* read).find((candidate) => candidate.key === key);
          if (!app) {
            if (absolute)
              return yield* new AudioError({
                operation: 'application',
                message: 'Audio application unavailable.',
              });
            return; // App disappeared; never substitute another knob's new occupant.
          }
          for (const stream of app.streams) {
            // Revalidate serial and application immediately before using the Pulse index.
            const fresh = (yield* read).find(
              (candidate) =>
                candidate.index === stream.index &&
                candidate.serial === stream.serial &&
                candidate.app === key,
            );
            if (!fresh) continue;
            if (change.delta !== 0 || absolute?.volume !== undefined) {
              const channels = changedChannels(
                fresh.channels,
                app.volume,
                absolute?.volume === undefined ? change.delta : absolute.volume - app.volume,
              ).map(String);
              yield* pactl.run(['set-sink-input-volume', String(fresh.index), ...channels]);
            }
            if (change.toggles % 2 || absolute?.muted !== undefined)
              yield* pactl.run([
                'set-sink-input-mute',
                String(fresh.index),
                absolute?.muted === undefined
                  ? app.muted
                    ? '0'
                    : '1'
                  : absolute.muted
                    ? '1'
                    : '0',
              ]);
          }
        }),
      );
    return AudioBackend.of({
      list: Effect.map(read, group),
      master: readMaster,
      changeMaster: (target, change) =>
        Semaphore.withPermits(
          lock,
          1,
        )(
          Effect.gen(function* () {
            yield* validateChange(change);
            const fresh = yield* readMaster;
            // A pending gesture must not spill onto a newly selected/recreated output.
            if (!fresh || fresh.name !== target.name || fresh.serial !== target.serial) return;
            if (change.delta !== 0)
              yield* pactl.run([
                'set-sink-volume',
                fresh.name,
                ...changedChannels(
                  fresh.channels,
                  fresh.volume,
                  change.delta,
                  MAX_MASTER_VOLUME_PERCENT,
                ).map(String),
              ]);
            if (change.toggles % 2)
              yield* pactl.run(['set-sink-mute', fresh.name, fresh.muted ? '0' : '1']);
          }),
        ),
      change: updateApplication,
      setApplication: (key, volume, muted) =>
        updateApplication(
          key,
          { delta: 0, toggles: 0 },
          {
            ...(volume === undefined ? {} : { volume }),
            ...(muted === undefined ? {} : { muted }),
          },
        ),
    });
  }),
);

/** Entirely inert audio fixture for the CLI's --mock mode. */
const makeMockLayer = (extraApps: boolean) =>
  Layer.effect(
    AudioBackend,
    Effect.sync(() => {
      let master: Master = {
        name: 'mock-output',
        serial: 'mock-output-1',
        channels: [32768, 32768],
        volume: 50,
        muted: false,
      };
      let streams: PlaybackStream[] = [
        {
          index: 1,
          serial: '1',
          app: 'discord',
          name: 'Discord',
          channels: [65536, 0],
          muted: false,
          paused: false,
        },
        {
          index: 2,
          serial: '2',
          app: 'spotify',
          name: 'Spotify',
          channels: [32768, 32768],
          muted: false,
          paused: false,
        },
      ];
      if (extraApps)
        streams.push(
          ...Array.from(
            { length: 6 },
            (_, i): PlaybackStream => ({
              index: i + 3,
              serial: `demo-${i}`,
              app: `demo-${i}`,
              name: `Demo ${i + 1}`,
              channels: [Math.round((PULSE_VOLUME_NORM * (i + 2)) / 10)],
              muted: false,
              paused: false,
            }),
          ),
        );
      return AudioBackend.of({
        list: Effect.sync(() => group(streams)),
        master: Effect.sync(() => master),
        changeMaster: (target, change) =>
          validateChange(change).pipe(
            Effect.andThen(
              Effect.sync(() => {
                if (target.name !== master.name || target.serial !== master.serial) return;
                const channels = change.delta
                  ? changedChannels(
                      master.channels,
                      master.volume,
                      change.delta,
                      MAX_MASTER_VOLUME_PERCENT,
                    )
                  : master.channels;
                master = {
                  ...master,
                  channels,
                  volume: (Math.max(...channels) / PULSE_VOLUME_NORM) * 100,
                  muted: change.toggles % 2 ? !master.muted : master.muted,
                };
              }),
            ),
          ),
        change: (key, change) =>
          validateChange(change).pipe(
            Effect.andThen(
              Effect.sync(() => {
                const app = group(streams).find((candidate) => candidate.key === key);
                if (!app) return;
                streams = streams.map((stream) =>
                  stream.app !== key
                    ? stream
                    : Object.assign({}, stream, {
                        channels: change.delta
                          ? changedChannels(stream.channels, app.volume, change.delta)
                          : stream.channels,
                        muted: change.toggles % 2 ? !app.muted : stream.muted,
                      }),
                );
              }),
            ),
          ),
      });
    }),
  );

/** Eight inert apps for exercising physical swipe/knob routing without changing real sound. */

export interface Commands {
  readonly setApplication?: (
    key: string,
    volume?: number,
    muted?: boolean,
  ) => Effect.Effect<void, AudioError>;
  readonly list: Effect.Effect<ReadonlyArray<Application>, AudioError>;
  readonly master: Effect.Effect<Master | undefined, AudioError>;
  readonly change: (key: string, change: Change) => Effect.Effect<void, AudioError>;
  readonly changeMaster: (target: Master, change: Change) => Effect.Effect<void, AudioError>;
}
export interface AudioState {
  readonly applications: ReadonlyArray<Application>;
  readonly master: Master | undefined;
}
/** Observable system service; legacy fresh reads and relative writes preserve existing mixer semantics. */
export const make = (backend: Commands) =>
  Effect.gen(function* () {
    const lock = yield* Semaphore.make(1);
    const read = Effect.all({ applications: backend.list, master: backend.master });
    const store = yield* State.polling(
      read,
      500,
      new AudioError({ operation: 'state', message: 'Audio unavailable.' }),
    );
    const write = (operation: Effect.Effect<void, AudioError>) =>
      store.guard(
        Semaphore.withPermits(
          lock,
          1,
        )(operation.pipe(Effect.andThen(store.refresh.pipe(Effect.ignore)), Effect.asVoid)),
      );
    const validVolume = (value: number, max: number) =>
      Number.isFinite(value) && value >= 0 && value <= max
        ? Effect.void
        : Effect.fail(
            new AudioError({ operation: 'volume', message: `Volume must be in 0..${max}.` }),
          );
    const application = (key: string, volume?: number, muted?: boolean) =>
      Effect.gen(function* () {
        if (volume !== undefined) yield* validVolume(volume, MAX_VOLUME_PERCENT);
        if (backend.setApplication) return yield* backend.setApplication(key, volume, muted);
        const app = (yield* backend.list).find((entry) => entry.key === key);
        if (!app)
          return yield* new AudioError({
            operation: 'application',
            message: 'Audio application unavailable.',
          });
        yield* backend.change(key, {
          delta: volume === undefined ? 0 : volume - app.volume,
          toggles: muted === undefined || muted === app.muted ? 0 : 1,
        });
      });
    const master = (volume?: number, muted?: boolean) =>
      Effect.gen(function* () {
        if (volume !== undefined) yield* validVolume(volume, MAX_MASTER_VOLUME_PERCENT);
        const target = yield* backend.master;
        if (!target)
          return yield* new AudioError({
            operation: 'master',
            message: 'Default audio output unavailable.',
          });
        yield* backend.changeMaster(target, {
          delta: volume === undefined ? 0 : volume - target.volume,
          toggles: muted === undefined || muted === target.muted ? 0 : 1,
        });
      });
    return {
      list: store.guard(backend.list),
      master: store.guard(backend.master),
      state: store.state,
      snapshot: store.snapshot,
      observe: store.observe,
      refresh: store.refresh,
      change: (key: string, change: Change) => write(backend.change(key, change)),
      changeMaster: (target: Master, change: Change) => write(backend.changeMaster(target, change)),
      setVolume: (key: string, percent: number) => write(application(key, percent)),
      setMuted: (key: string, muted: boolean) => write(application(key, undefined, muted)),
      setMasterVolume: (percent: number) => write(master(percent)),
      setMasterMuted: (muted: boolean) => write(master(undefined, muted)),
    };
  });
export class Audio extends Context.Service<Audio, Effect.Success<ReturnType<typeof make>>>()(
  '@nixfiles/system-control/Audio',
) {}
export const makeLayer = (commands: Commands) => Layer.effect(Audio, make(commands));
const observedLayer = Layer.effect(Audio, Effect.flatMap(AudioBackend, make));
export const serviceLayer = observedLayer.pipe(Layer.provide(backendLayer));
export const layer = serviceLayer.pipe(Layer.provide(pactlLayer));
export const mockLayer = observedLayer.pipe(Layer.provide(makeMockLayer(false)));
export const demoLayer = observedLayer.pipe(Layer.provide(makeMockLayer(true)));
