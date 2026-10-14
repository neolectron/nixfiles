import {
  Clock,
  Context,
  Effect,
  Layer,
  Ref,
  Result,
  Schedule,
  Schema,
  Semaphore,
  Stream,
} from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { IntegrationError } from './json-socket.ts';
import * as Sources from './sources.ts';
const nextLoop = (state: State) =>
  state.loop === 'None' ? 'Playlist' : state.loop === 'Playlist' ? 'Track' : 'None';
const path = '/org/mpris/MediaPlayer2';
const player = 'org.mpris.MediaPlayer2.Player';
const properties = 'org.freedesktop.DBus.Properties';
const string = Schema.Struct({ type: Schema.Literal('s'), data: Schema.String });
const boolean = Schema.Struct({ type: Schema.Literal('b'), data: Schema.Boolean });
const variant = Schema.Struct({ type: Schema.String, data: Schema.Unknown });
const reply = Schema.Struct({
  type: Schema.Literal('a{sv}'),
  data: Schema.Tuple([
    Schema.Struct({
      PlaybackStatus: Schema.Struct({
        type: Schema.Literal('s'),
        data: Schema.Literals(['Playing', 'Paused', 'Stopped']),
      }),
      CanControl: boolean,
      CanGoNext: boolean,
      CanGoPrevious: boolean,
      CanPlay: boolean,
      CanPause: boolean,
      CanSeek: boolean,
      Shuffle: Schema.optional(boolean),
      LoopStatus: Schema.optional(
        Schema.Struct({
          type: Schema.Literal('s'),
          data: Schema.Literals(['None', 'Track', 'Playlist']),
        }),
      ),
      Metadata: Schema.optional(
        Schema.Struct({
          type: Schema.Literal('a{sv}'),
          data: Schema.Record(Schema.String, variant),
        }),
      ),
      Position: Schema.optional(variant),
      Rate: Schema.optional(variant),
    }),
  ]),
});
export interface State {
  readonly status: 'Playing' | 'Paused' | 'Stopped';
  readonly title: string;
  readonly artists: ReadonlyArray<string>;
  readonly canControl: boolean;
  readonly canNext: boolean;
  readonly canPrevious: boolean;
  readonly canPlay: boolean;
  readonly canPause: boolean;
  readonly canSeek: boolean;
  readonly shuffle: boolean | null;
  readonly loop: 'None' | 'Track' | 'Playlist' | null;
  readonly trackId: string | null;
  readonly durationMicros: number | null;
  readonly positionMicros: number | null;
  readonly sampledAt: number;
  readonly rate: number;
  readonly artUrl: string | null;
}
const micros = Schema.Struct({
  type: Schema.Literal('x'),
  data: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
});
const microValue = (value: unknown) => {
  const decoded = Schema.decodeUnknownOption(micros)(value);
  return decoded._tag === 'Some' ? decoded.value.data : null;
};
/** Position has no change notifications; advance the last sample only while playing. */
export const positionAt = (state: State, now: number) => {
  if (state.positionMicros === null) return null;
  const value =
    state.positionMicros +
    (state.status === 'Playing' ? Math.max(0, now - state.sampledAt) * 1000 * state.rate : 0);
  return Math.max(0, state.durationMicros === null ? value : Math.min(value, state.durationMicros));
};
export type Command = 'PlayPause' | 'Play' | 'Pause' | 'Stop' | 'Next' | 'Previous';
/** Replaceable D-Bus boundary. busctl JSON avoids parsing GVariant text or invoking a shell. */
export class MprisTransport extends Context.Service<
  MprisTransport,
  {
    readonly ready: Effect.Effect<void, IntegrationError>;
    readonly run: (args: ReadonlyArray<string>) => Effect.Effect<string, IntegrationError>;
  }
>()('@nixfiles/streamdeck/MprisTransport') {
  static readonly layer = Layer.effect(
    MprisTransport,
    Effect.gen(function* () {
      const processes = yield* ChildProcessSpawner.ChildProcessSpawner;
      const run = (args: ReadonlyArray<string>) =>
        Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* processes.spawn(
              ChildProcess.make('busctl', args, { stdin: 'ignore' }),
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
                new IntegrationError({
                  message: `MPRIS indisponible : ${err.trim().slice(-600) || 'ouvre un lecteur dans cette session.'}`,
                }),
              );
            return out;
          }),
        ).pipe(
          Effect.timeout('3 seconds'),
          Effect.mapError((cause) =>
            cause instanceof IntegrationError
              ? cause
              : new IntegrationError({
                  message:
                    'busctl indisponible ou D-Bus ne répond pas. Utilise le shell Nix du projet.',
                }),
          ),
        );
      return { ready: run(['--version']).pipe(Effect.asVoid), run };
    }),
  );
}
/** One player per service; queries/toggles are serialized and the cache survives app restarts. */
export const make = (busName: string, name = 'Lecteur') =>
  Effect.gen(function* () {
    if (
      busName.length > 255 ||
      !/^org\.mpris\.MediaPlayer2\.[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*$/.test(
        busName,
      )
    )
      return yield* Effect.fail(new IntegrationError({ message: 'Nom D-Bus MPRIS invalide.' }));
    const transport = yield* MprisTransport;
    yield* transport.ready;
    const lock = yield* Semaphore.make(1);
    const cached = yield* Ref.make<Result.Result<State, IntegrationError>>(
      Result.fail(new IntegrationError({ message: `Ouvre ${name} pour lire son état.` })),
    );
    // --auto-start=no: merely enabling the plugin never launches an application or changes playback.
    const run = (args: ReadonlyArray<string>) =>
      transport.run(['--user', '--json=short', '--timeout=2s', '--auto-start=no', ...args]);
    const read = run(['call', busName, path, properties, 'GetAll', 's', player]).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(reply))),
      Effect.flatMap(({ data: [props] }) =>
        Effect.gen(function* () {
          const metadata = props.Metadata?.data ?? {};
          const title = Schema.decodeUnknownOption(string)(metadata['xesam:title']);
          const artist = Schema.decodeUnknownOption(
            Schema.Struct({ type: Schema.Literal('as'), data: Schema.Array(Schema.String) }),
          )(metadata['xesam:artist']);
          const track = Schema.decodeUnknownOption(
            Schema.Struct({ type: Schema.Literal('o'), data: Schema.String }),
          )(metadata['mpris:trackid']);
          const art = Schema.decodeUnknownOption(string)(metadata['mpris:artUrl']);
          const rate = Schema.decodeUnknownOption(
            Schema.Struct({
              type: Schema.Literal('d'),
              data: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0)),
            }),
          )(props.Rate);
          return {
            status: props.PlaybackStatus.data,
            title: title._tag === 'Some' ? title.value.data : '',
            artists: artist._tag === 'Some' ? artist.value.data : [],
            canControl: props.CanControl.data,
            canNext: props.CanGoNext.data,
            canPrevious: props.CanGoPrevious.data,
            canPlay: props.CanPlay.data,
            canPause: props.CanPause.data,
            canSeek: props.CanSeek.data,
            shuffle: props.Shuffle?.data ?? null,
            loop: props.LoopStatus?.data ?? null,
            trackId: track._tag === 'Some' ? track.value.data : null,
            durationMicros: microValue(metadata['mpris:length']),
            positionMicros: microValue(props.Position),
            artUrl: art._tag === 'Some' && art.value.data ? art.value.data : null,
            rate: rate._tag === 'Some' ? rate.value.data : 1,
            sampledAt: yield* Clock.currentTimeMillis,
          } satisfies State;
        }),
      ),
      Effect.mapError((cause) =>
        cause instanceof IntegrationError
          ? cause
          : new IntegrationError({ message: `État MPRIS ${name} invalide.` }),
      ),
    );
    const refresh = Effect.gen(function* () {
      const result = yield* Effect.result(read);
      yield* Ref.set(cached, result);
      return yield* Effect.fromResult(result);
    });
    const current = Semaphore.withPermits(lock, 1)(refresh);
    const mutate = (
      allowed: (state: State) => boolean,
      args: (state: State) => ReadonlyArray<string>,
      description: string,
      confirmed?: (before: State, after: State) => boolean,
    ) =>
      Semaphore.withPermits(
        lock,
        1,
      )(
        Effect.gen(function* () {
          const before = yield* refresh;
          if (!before.canControl || !allowed(before))
            return yield* Effect.fail(
              new IntegrationError({
                message: `${name} ne permet pas ${description} actuellement.`,
              }),
            );
          yield* run(args(before));
          // Spotify can acknowledge D-Bus before updating its properties. Query only; never resend a toggle.
          return yield* confirmed
            ? Effect.repeat(refresh, {
                until: (after) => confirmed(before, after),
                schedule: Schedule.spaced(50),
              }).pipe(
                Effect.timeout('2 seconds'),
                Effect.mapError((cause) =>
                  cause instanceof IntegrationError
                    ? cause
                    : new IntegrationError({
                        message: `Commande envoyée, mais ${name} n’a pas confirmé le nouvel état. Vérifie la lecture avant de réessayer.`,
                      }),
                ),
              )
            : refresh;
        }),
      );
    const call = (method: string, ...args: ReadonlyArray<string>) => [
      'call',
      busName,
      path,
      player,
      method,
      ...args,
    ];
    const command = (method: Command) =>
      mutate(
        (state) =>
          method === 'Next'
            ? state.canNext
            : method === 'Previous'
              ? state.canPrevious
              : method === 'Play'
                ? state.canPlay
                : method === 'Pause'
                  ? state.canPause
                  : method === 'PlayPause'
                    ? state.status === 'Playing'
                      ? state.canPause
                      : state.canPlay
                    : true,
        () => call(method),
        'cette commande',
        method === 'Next' || method === 'Previous'
          ? undefined
          : (before, after) =>
              after.status ===
              (method === 'PlayPause'
                ? before.status === 'Playing'
                  ? 'Paused'
                  : 'Playing'
                : method === 'Play'
                  ? 'Playing'
                  : method === 'Pause'
                    ? 'Paused'
                    : 'Stopped'),
      );
    const seek = (seconds: number) =>
      !Number.isFinite(seconds) || Math.abs(seconds) > 300
        ? Effect.fail(
            new IntegrationError({
              message: 'Le déplacement doit être compris entre −300 et 300 secondes.',
            }),
          )
        : mutate(
            (state) => state.canSeek,
            () => call('Seek', 'x', String(Math.round(seconds * 1000000))),
            'le déplacement dans la piste',
          );
    const set = (candidateName: string, type: string, value: string) => [
      'set-property',
      busName,
      path,
      player,
      candidateName,
      type,
      value,
    ];
    const toggleShuffle = mutate(
      (state) => state.shuffle !== null,
      (state) => set('Shuffle', 'b', String(!state.shuffle)),
      'le mode aléatoire',
      (before, after) => after.shuffle === !before.shuffle,
    );
    const cycleLoop = mutate(
      (state) => state.loop !== null,
      (state) => set('LoopStatus', 's', nextLoop(state)),
      'la répétition',
      (before, after) => after.loop === nextLoop(before),
    );
    yield* current.pipe(Effect.ignore);
    // Absence/errors are cached as offline feedback, rather than disabling the plugin permanently.
    const monitor = Stream.runDrain(Sources.poll(current.pipe(Effect.ignore), '1 second'));
    const state = Effect.flatMap(Ref.get(cached), Effect.fromResult);
    return { current, state, command, seek, toggleShuffle, cycleLoop, monitor };
  });
export type Controller = Effect.Success<ReturnType<typeof make>>;
