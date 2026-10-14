import { Config, Context, Effect, Layer, Redacted, Result } from 'effect';
import { IntegrationError } from './errors.ts';
import { JsonSocket, type Message } from './json-socket.ts';
import * as Rpc from './obs-rpc.ts';
import * as State from './state.ts';

const offline = () =>
  new IntegrationError({
    message: 'OBS WebSocket hors ligne. Ouvre OBS et active son serveur WebSocket.',
  });
/** Activation is independent of connectivity. The scope owns reconnects and sockets. */
export const make = (options: Parameters<typeof Rpc.make>[0]) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<JsonSocket | import('effect').Crypto.Crypto>();
    const store = yield* State.make<{ readonly connected: true }, IntegrationError>(offline());
    let active: Effect.Success<ReturnType<typeof Rpc.make>> | undefined;
    const session = Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            active = undefined;
          }),
        );
        active = yield* Rpc.make(options);
        yield* store.publish(Result.succeed({ connected: true }));
        return yield* active.failure;
      }),
    ).pipe(
      Effect.provideContext(context),
      Effect.catch((error) => store.publish(Result.fail(error))),
    );
    yield* Effect.forkScoped(
      Effect.forever(session.pipe(Effect.andThen(Effect.sleep('1 second')))),
    );
    return {
      state: store.state,
      snapshot: store.snapshot,
      observe: store.observe,
      request: (requestType: string, requestData: Message = {}) =>
        store.guard(
          Effect.suspend(() =>
            active
              ? active
                  .request(requestType, requestData)
                  .pipe(
                    Effect.mapError((error) =>
                      error instanceof IntegrationError
                        ? error
                        : new IntegrationError({ message: 'Requête OBS échouée.' }),
                    ),
                  )
              : Effect.fail(offline()),
          ),
        ),
    };
  });
export type Controller = Effect.Success<ReturnType<typeof make>>;
export class Obs extends Context.Service<Obs, Controller>()('@nixfiles/system-control/Obs') {
  static readonly serviceLayer = (options: Parameters<typeof make>[0]) =>
    Layer.effect(Obs, make(options));
  static readonly layer = Layer.effect(
    Obs,
    Effect.gen(function* () {
      const url = yield* Config.String('STREAMDECK_OBS_URL').pipe(
        Config.withDefault('ws://127.0.0.1:4455'),
      );
      const password = yield* Config.Redacted('STREAMDECK_OBS_PASSWORD').pipe(
        Config.withDefault(Redacted.make('')),
      );
      return yield* make({ url, password });
    }),
  ).pipe(Layer.provide(JsonSocket.layer));
}
