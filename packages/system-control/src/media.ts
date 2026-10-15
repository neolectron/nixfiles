import { invariant, IntegrationError } from './errors.ts';
import { Context, Layer, Effect, Option, Ref, Result, Schema, Semaphore, Stream } from 'effect';
import { MprisRegistry } from './mpris-registry.ts';
import * as Mpris from './mpris.ts';
import * as StateStore from './state.ts';
import * as Sources from './sources.ts';
// A newly started player wins; retain the selected player on ties and pause.
const priority = (state: State) =>
  state.playback.status === 'Playing' ? 2 : state.playback.status === 'Paused' ? 1 : 0;
const Players = Schema.Array(
  Schema.Struct({ name: Schema.String, process: Schema.optional(Schema.NullOr(Schema.String)) }),
);
export interface State {
  readonly busName: string;
  readonly name: string;
  readonly playback: Mpris.State;
}
/** Global media controls select one active player, independent of Spotify and window focus. */
export const make = Effect.gen(function* () {
  const transport = yield* Mpris.MprisTransport;
  const registry = yield* Effect.serviceOption(MprisRegistry);
  yield* transport.ready.pipe(Effect.ignore);
  const lock = yield* Semaphore.make(1);
  const cached = yield* Ref.make<Result.Result<State, IntegrationError>>(
    Result.fail(new IntegrationError({ message: 'Aucun lecteur média disponible.' })),
  );
  const players = new Map<
    string,
    {
      api: Mpris.Controller;
      status: Mpris.State['status'];
      activity: number;
    }
  >();
  let selected: string | undefined;
  let sequence = 0;
  const refresh = Effect.gen(function* () {
    const list = yield* transport
      .run(['--user', '--json=short', '--timeout=2s', '--auto-start=no', 'list'])
      .pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Players))),
        Effect.mapError((error) =>
          error instanceof IntegrationError
            ? error
            : new IntegrationError({ message: 'Liste des lecteurs MPRIS invalide.' }),
        ),
      );
    const names = list.filter((entry) => entry.name.startsWith('org.mpris.MediaPlayer2.'));
    for (const key of players.keys())
      if (!names.some((entry) => entry.name === key)) players.delete(key);
    const available: Array<
      State & {
        activity: number;
      }
    > = [];
    for (const entry of names) {
      const name = (
        entry.process?.replace(/^\./, '').replace(/-wrap(?:per)?$/, '') ||
        entry.name.slice('org.mpris.MediaPlayer2.'.length)
      ).slice(0, 40);
      const existing = players.get(entry.name);
      const result = yield* Effect.result(
        Effect.gen(function* () {
          const api =
            existing?.api ??
            (yield* (
              Option.isSome(registry)
                ? registry.value.player(entry.name, name)
                : Mpris.make(entry.name, name)
            ).pipe(Effect.provideService(Mpris.MprisTransport, transport)));
          const playback = yield* existing && Option.isNone(registry) ? api.current : api.state;
          const started =
            playback.status === 'Playing' &&
            (existing ? existing.status !== 'Playing' : selected !== undefined);
          const activity = started ? ++sequence : (existing?.activity ?? 0);
          players.set(entry.name, { api, status: playback.status, activity });
          return { busName: entry.name, name, playback, activity };
        }),
      );
      if (Result.isSuccess(result) && result.success.playback.canControl)
        available.push(result.success);
    }
    available.sort(
      (a, b) =>
        priority(b) - priority(a) ||
        b.activity - a.activity ||
        Number(b.busName === selected) - Number(a.busName === selected) ||
        a.busName.localeCompare(b.busName),
    );
    const target = available[0];
    if (!target)
      return yield* Effect.fail(
        new IntegrationError({
          message: 'Aucun lecteur média disponible. Ouvre Spotify ou un média dans ton navigateur.',
        }),
      );
    selected = target.busName;
    return { busName: target.busName, name: target.name, playback: target.playback };
  });
  const current = Semaphore.withPermits(
    lock,
    1,
  )(
    Effect.gen(function* () {
      const result = yield* Effect.result(refresh);
      yield* Ref.set(cached, result);
      return yield* Effect.fromResult(result);
    }),
  );
  const command = (method: Mpris.Command) =>
    Semaphore.withPermits(
      lock,
      1,
    )(
      Effect.gen(function* () {
        const target = yield* refresh;
        const playback = yield* invariant(players.get(target.busName), 'media').api.command(method);
        const state = { ...target, playback };
        yield* Ref.set(cached, Result.succeed(state));
        return state;
      }),
    );
  yield* current.pipe(Effect.ignore);
  return {
    current,
    command,
    state: Effect.flatMap(Ref.get(cached), Effect.fromResult),
    monitor: Stream.runDrain(Sources.poll(current.pipe(Effect.ignore), '1 second')),
  };
});
export type Controller = Omit<Effect.Success<typeof make>, 'monitor'>;

export const managed = Effect.gen(function* () {
  const raw = yield* make;
  const store = yield* StateStore.polling(
    raw.current,
    '1 second',
    new IntegrationError({ message: 'No media player available.' }),
    'media',
  );
  return {
    current: store.refresh,
    state: store.state,
    snapshot: store.snapshot,
    observe: store.observe,
    command: (method: Mpris.Command) =>
      store
        .guard(raw.command(method))
        .pipe(Effect.tap((state) => store.publish(Result.succeed(state)))),
  };
});
export class MediaPlayers extends Context.Service<MediaPlayers, Effect.Success<typeof managed>>()(
  '@nixfiles/system-control/MediaPlayers',
) {
  static readonly serviceLayer = Layer.effect(MediaPlayers, managed);
  static readonly layer = MediaPlayers.serviceLayer.pipe(Layer.provide(Mpris.MprisTransport.layer));
}
