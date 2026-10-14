import { Config, Context, Crypto, Deferred, Effect, Layer, Redacted, Schema, Semaphore } from 'effect';
import { IntegrationError, JsonSocket, requests } from '../json-socket.ts';
import * as Plugin from '../plugin.ts';
import { commandFromConfig } from './command-bridge.ts';

const settings = Schema.Struct({ mute: Schema.Boolean, deaf: Schema.Boolean });
export const make = (options: { readonly clientId: string; readonly accessToken: Redacted.Redacted<string>; readonly port?: number }) => Effect.gen(function*() {
  const socket = yield* JsonSocket; const crypto = yield* Crypto.Crypto; const replies = yield* requests; const lock = yield* Semaphore.make(1);
  const ready = yield* Deferred.make<void, IntegrationError>();
  const connection = yield* socket.connect(`ws://127.0.0.1:${options.port ?? 6463}/?v=1&client_id=${encodeURIComponent(options.clientId)}`, (message) => Effect.gen(function*() {
    if (message.evt === 'READY') yield* Deferred.succeed(ready, undefined);
    if (typeof message.nonce === 'string') {
      const data = typeof message.data === 'object' && message.data !== null && !Array.isArray(message.data) ? message.data as Record<string, unknown> : {};
      yield* replies.reply(message.nonce, message.evt === 'ERROR' ? new IntegrationError({ message: 'Discord a refusé la commande RPC. Vérifie les autorisations de l’application.' }) : data);
    }
  }));
  yield* Effect.raceFirst(Deferred.await(ready), connection.failure).pipe(Effect.timeout('5 seconds'));
  const request = (cmd: string, args: Record<string, unknown> = {}) => Effect.gen(function*() {
    const nonce = yield* crypto.randomUUIDv4();
    return yield* replies.call(nonce, connection.send({ cmd, args, nonce }), connection.failure);
  });
  yield* request('AUTHENTICATE', { access_token: Redacted.value(options.accessToken) });
  const current = request('GET_VOICE_SETTINGS').pipe(Effect.flatMap(Schema.decodeUnknownEffect(settings)), Effect.mapError(() => new IntegrationError({ message: 'Réglages vocaux Discord indisponibles.' })));
  const toggle = (field: 'mute' | 'deaf') => Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
    const before = yield* current;
    return yield* request('SET_VOICE_SETTINGS', { [field]: !before[field] });
  }));
  return { current, toggle, failure: connection.failure };
}).pipe(Effect.mapError((error) => error instanceof IntegrationError ? error : new IntegrationError({ message: 'Connexion RPC Discord échouée.' })));
export type Controller = Effect.Success<ReturnType<typeof make>>;
export class Discord extends Context.Service<Discord, Controller>()('@nixfiles/streamdeck/Discord') {
  static readonly layer = Layer.effect(Discord, Effect.gen(function*() {
    const clientId = yield* Config.String('STREAMDECK_DISCORD_CLIENT_ID');
    const accessToken = yield* Config.Redacted('STREAMDECK_DISCORD_ACCESS_TOKEN');
    const port = yield* Config.Int('STREAMDECK_DISCORD_PORT').pipe(Config.withDefault(6463));
    return yield* make({ clientId, accessToken, port });
  }).pipe(Effect.mapError(() => new IntegrationError({ message: 'Configure STREAMDECK_DISCORD_CLIENT_ID et STREAMDECK_DISCORD_ACCESS_TOKEN pour une application RPC autorisée. Le port local peut être défini par STREAMDECK_DISCORD_PORT.' })))).pipe(Layer.provide(JsonSocket.layer));
}
const input = Plugin.NoInput;
export const plugin = Plugin.fromLayer({
  id: 'discord', name: 'Discord', description: 'Mute/deafen et réglages vocaux via le RPC local autorisé.', controls: {}, service: Discord, layer: Discord.layer, run: (api) => api.failure,
  actions: [
    Plugin.action({ id: 'status', name: 'État vocal Discord', description: 'Lit les réglages vocaux réels.', input, defaults: {}, run: (api: Controller) => api.current }),
    Plugin.action({ id: 'mute', name: 'Mute Discord', description: 'Bascule le mute du micro Discord.', input, defaults: {}, run: (api: Controller) => api.toggle('mute') }),
    Plugin.action({ id: 'deafen', name: 'Deafen Discord', description: 'Bascule le deafen Discord.', input, defaults: {}, run: (api: Controller) => api.toggle('deaf') }),
  ],
});
/** Discord has no documented RPC command for screen sharing. An explicit bridge owns that operation. */
export const screenSharePlugin = Plugin.define({
  id: 'discord-screen-share', name: 'Discord · partage d’écran', description: 'Appelle ton script de partage d’écran ; aucune commande RPC officielle ne l’expose.', controls: {},
  setup: Effect.gen(function*() { const run = yield* commandFromConfig('STREAMDECK_DISCORD_SCREEN_SHARE'); return { api: { run } }; }),
  actions: [Plugin.action({ id: 'share-screen', name: 'Partager l’écran', description: 'Exécute le bridge configuré explicitement.', input, defaults: {}, run: (api: { run: Effect.Effect<string, IntegrationError> }) => api.run })],
});
