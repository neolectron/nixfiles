import { Config, Context, Layer, Option, Effect, Result, Semaphore, Stream } from 'effect';
import * as Mpris from './mpris.ts';
import * as StateStore from './state.ts';
import * as Sources from './sources.ts';
import { IntegrationError } from './errors.ts';
import type { Identity } from './application-identity.ts';
export const keyForApplication = (key: string) =>
  key === 'spotify' || key === 'com.spotify.client'
    ? 'spotify'
    : key === 'spotifast'
      ? 'spotifast'
      : undefined;
const identity = (key: string, name: string): Identity =>
  key === 'spotify' ? { key, name, aliases: ['com.spotify.client'] } : { key, name };

export interface Controller extends Mpris.Controller {
  readonly forApplication?: (key: string) => Effect.Effect<Mpris.State, IntegrationError>;
  readonly applications?: Effect.Effect<ReadonlyArray<Identity>>;
}
/** Spotify and Spotifast share actions, but retain separate metadata for their own LCD cards. */
export const make = (override?: string) =>
  Effect.gen(function* () {
    const candidates = override
      ? [
          {
            busName: override,
            key: override.includes('spotifast') ? 'spotifast' : 'spotify',
            name: override.includes('spotifast') ? 'Spotifast' : 'Spotify',
          },
        ]
      : [
          { busName: 'org.mpris.MediaPlayer2.spotify', key: 'spotify', name: 'Spotify' },
          { busName: 'org.mpris.MediaPlayer2.spotifast', key: 'spotifast', name: 'Spotifast' },
        ];
    const players = yield* Effect.forEach(candidates, (candidate) =>
      Mpris.make(candidate.busName, candidate.name).pipe(
        Effect.map((api) => ({ ...candidate, api })),
      ),
    );
    const lock = yield* Semaphore.make(1);
    let selected: string | undefined;
    const choose = (refresh: boolean) =>
      Effect.gen(function* () {
        const available: Array<{ player: (typeof players)[number]; state: Mpris.State }> = [];
        for (const player of players) {
          const result = yield* Effect.result(refresh ? player.api.current : player.api.state);
          if (Result.isSuccess(result)) available.push({ player, state: result.success });
        }
        available.sort(
          (a, b) =>
            Number(b.state.status === 'Playing') - Number(a.state.status === 'Playing') ||
            Number(b.player.key === selected) - Number(a.player.key === selected),
        );
        const target = available[0];
        if (!target)
          return yield* Effect.fail(
            new IntegrationError({ message: 'Ouvre Spotify ou Spotifast dans cette session.' }),
          );
        if (refresh) selected = target.player.key;
        return target;
      });
    const current = Semaphore.withPermits(
      lock,
      1,
    )(choose(true).pipe(Effect.map((target) => target.state)));
    const execute = (
      run: (api: Mpris.Controller) => Effect.Effect<Mpris.State, IntegrationError>,
    ) =>
      Semaphore.withPermits(
        lock,
        1,
      )(choose(true).pipe(Effect.flatMap((target) => run(target.player.api))));
    return {
      current,
      state: choose(false).pipe(Effect.map((target) => target.state)),
      command: (method: Mpris.Command) => execute((api) => api.command(method)),
      seek: (seconds: number) => execute((api) => api.seek(seconds)),
      toggleShuffle: execute((api) => api.toggleShuffle),
      cycleLoop: execute((api) => api.cycleLoop),
      forApplication: (key: string) =>
        players.find((player) => player.key === key)?.api.state ??
        Effect.fail(new IntegrationError({ message: 'Lecteur introuvable.' })),
      applications: Effect.gen(function* () {
        const values: Identity[] = [];
        for (const player of players) {
          const result = yield* Effect.result(player.api.state);
          if (Result.isSuccess(result) && result.success.title)
            values.push(identity(player.key, player.name));
        }
        return values;
      }),
      monitor: Stream.runDrain(Sources.poll(current.pipe(Effect.ignore), '1 second')),
    };
  });

export const managed = (override?: string) =>
  Effect.gen(function* () {
    const raw = yield* make(override);
    const store = yield* StateStore.polling(
      raw.current,
      '1 second',
      new IntegrationError({ message: 'No Spotify player available.' }),
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
      seek: (seconds: number) =>
        store
          .guard(raw.seek(seconds))
          .pipe(Effect.tap((state) => store.publish(Result.succeed(state)))),
      toggleShuffle: store
        .guard(raw.toggleShuffle)
        .pipe(Effect.tap((state) => store.publish(Result.succeed(state)))),
      cycleLoop: store
        .guard(raw.cycleLoop)
        .pipe(Effect.tap((state) => store.publish(Result.succeed(state)))),
      forApplication: raw.forApplication,
      applications: raw.applications,
    };
  });
export class Spotify extends Context.Service<Spotify, Effect.Success<ReturnType<typeof managed>>>()(
  '@nixfiles/system-control/Spotify',
) {
  static readonly serviceLayer = (busName?: string) => Layer.effect(Spotify, managed(busName));
  static readonly layer = Layer.effect(
    Spotify,
    Effect.gen(function* () {
      const bus = yield* Config.String('STREAMDECK_SPOTIFY_BUS_NAME').pipe(Config.option);
      return yield* managed(Option.getOrUndefined(bus));
    }),
  ).pipe(Layer.provide(Mpris.MprisTransport.layer));
}
