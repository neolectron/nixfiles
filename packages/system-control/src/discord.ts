import {
  Config,
  Context,
  Crypto,
  Deferred,
  Effect,
  Layer,
  Option,
  Redacted,
  Result,
  Stream,
} from 'effect';
import { IntegrationError } from './errors.ts';
import { DiscordTransport } from './discord-ipc.ts';
import { DiscordConnection, DiscordOAuth } from './discord-connection.ts';
import * as Rpc from './discord-rpc.ts';
import * as StateStore from './state.ts';
export type VoiceState = Rpc.VoiceState;
export interface Options {
  readonly clientId: string;
  readonly accessToken: Redacted.Redacted<string>;
}
const offline = () => new IntegrationError({ message: 'Discord RPC hors ligne.' });

/** A stable service object across reconnects; only operation/state errors cross the boundary. */
export const make = <R>(options: Effect.Effect<Options, IntegrationError, R>) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<R | Crypto.Crypto | DiscordTransport>();
    const store = yield* StateStore.make<VoiceState, IntegrationError>(offline(), 'discord');
    let active: Effect.Success<ReturnType<typeof Rpc.make>> | undefined;
    let restart: Deferred.Deferred<void> | undefined;
    const session = Effect.scoped(
      Effect.gen(function* () {
        const requested = yield* Deferred.make<void>();
        restart = requested;
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            active = undefined;
            restart = undefined;
          }),
        );
        const api = yield* Rpc.make(yield* options);
        active = api;
        yield* store.publish(Result.succeed(yield* api.current));
        yield* Effect.raceFirst(
          Effect.raceFirst(
            api.failure,
            Deferred.await(requested).pipe(Effect.andThen(Effect.fail(offline()))),
          ),
          Stream.runForEach(api.observe, () =>
            Effect.flatMap(Effect.result(api.voice), store.publish),
          ),
        );
      }),
    ).pipe(
      Effect.provideContext(context),
      Effect.catch((error) => store.publish(Result.fail(error))),
    );
    yield* Effect.forkScoped(
      Effect.forever(store.session(session).pipe(Effect.andThen(Effect.sleep('1 second')))),
    );
    const connected = <A>(
      operation: (api: NonNullable<typeof active>) => Effect.Effect<A, IntegrationError>,
    ) =>
      store.guard(
        Effect.suspend(() =>
          active
            ? operation(active)
            : Effect.flatMap(store.snapshot, (state) =>
                Effect.fail(Result.isFailure(state) ? state.failure : offline()),
              ),
        ),
      );
    return {
      current: connected((api) => api.current).pipe(
        Effect.tap((state) => store.publish(Result.succeed(state))),
      ),
      voice: store.state,
      state: store.state,
      snapshot: store.snapshot,
      observe: store.observe,
      toggle: (field: 'mute' | 'deaf') =>
        connected((api) => api.toggle(field)).pipe(
          Effect.tap((state) => store.publish(Result.succeed(state))),
        ),
      set: (field: 'mute' | 'deaf', value: boolean) =>
        connected((api) => api.set(field, value)).pipe(
          Effect.tap((state) => store.publish(Result.succeed(state))),
        ),
      reconnect: Effect.suspend(() =>
        restart ? Deferred.succeed(restart, undefined).pipe(Effect.asVoid) : Effect.void,
      ),
    };
  });
export const configuredOptions = Effect.gen(function* () {
  const saved = yield* Effect.serviceOption(DiscordConnection);
  if (Option.isSome(saved)) {
    const settings = yield* saved.value.options;
    if (settings) return settings;
  }
  const clientId = yield* Config.String('STREAMDECK_DISCORD_CLIENT_ID').pipe(Config.option);
  const accessToken = yield* Config.Redacted('STREAMDECK_DISCORD_ACCESS_TOKEN').pipe(Config.option);
  if (Option.isNone(clientId) || Option.isNone(accessToken))
    return yield* new IntegrationError({
      message:
        'Connexion RPC Discord à configurer : application autorisée et autorisation OAuth nécessaires.',
    });
  return { clientId: clientId.value, accessToken: accessToken.value };
}).pipe(
  Effect.mapError((error) =>
    error instanceof IntegrationError
      ? error
      : new IntegrationError({ message: 'Configuration Discord indisponible.' }),
  ),
);
export class Discord extends Context.Service<
  Discord,
  Effect.Success<ReturnType<typeof make<never>>>
>()('@nixfiles/system-control/Discord') {
  static readonly serviceLayer = <R>(options: Effect.Effect<Options, IntegrationError, R>) =>
    Layer.effect(Discord, make(options));
  static readonly layer = Discord.serviceLayer(configuredOptions).pipe(
    Layer.provide(Layer.mergeAll(DiscordTransport.layer, DiscordOAuth.layer)),
  );
}
