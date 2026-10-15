import { Context, Effect, Layer, Semaphore } from 'effect';
import { MprisPlayer, MprisTransport, type Controller } from './mpris.ts';

/** Shared per-bus cache and polling lifecycle, independent of media-selection policies. */
export const make = Effect.gen(function* () {
  const owner = yield* Effect.scope;
  const transport = yield* MprisTransport;
  const lock = yield* Semaphore.make(1);
  const players = new Map<string, Controller>();
  return {
    player: (busName: string, name: string) =>
      Semaphore.withPermits(
        lock,
        1,
      )(
        Effect.gen(function* () {
          const existing = players.get(busName);
          if (existing) return existing;
          const services = yield* Layer.buildWithScope(
            MprisPlayer.serviceLayer(busName, name).pipe(
              Layer.provide(Layer.succeed(MprisTransport, transport)),
            ),
            owner,
          );
          const player = Context.get(services, MprisPlayer);
          players.set(busName, player);
          return player;
        }),
      ),
    count: Effect.sync(() => players.size),
  };
});
export class MprisRegistry extends Context.Service<MprisRegistry, Effect.Success<typeof make>>()(
  '@nixfiles/system-control/MprisRegistry',
) {
  static readonly layer = Layer.effect(MprisRegistry, make).pipe(
    Layer.provide(MprisTransport.layer),
  );
}
