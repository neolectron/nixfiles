import { Config, Context, Crypto, Deferred, Effect, Layer, Option, Redacted, Ref, Result, Schema, Semaphore } from 'effect';
import { IntegrationError, requests, type Message } from '../json-socket.ts';
import { DiscordTransport } from '../discord-ipc.ts';
import * as Plugin from '../plugin.ts';
import { commandFromConfig } from './command-bridge.ts';
import { DesktopKeys, makeDiscordKeys } from '../desktop-keys.ts';
import type { KeyFeedback } from '../key-feedback.ts';
import { DiscordConnection, DiscordOAuth } from '../discord-connection.ts';
import { rpcError } from '../discord-rpc-error.ts';

const settings = Schema.Struct({ mute: Schema.Boolean, deaf: Schema.Boolean });
export type VoiceState = typeof settings.Type;
export const make = (options: { readonly clientId: string; readonly accessToken: Redacted.Redacted<string> }) => Effect.gen(function*() {
  const socket = yield* DiscordTransport; const crypto = yield* Crypto.Crypto; const replies = yield* requests; const lock = yield* Semaphore.make(1);
  const ready = yield* Deferred.make<void, IntegrationError>();
  const voice = yield* Ref.make<Option.Option<VoiceState>>(Option.none());
  const voiceRequests = new Set<string>();
  const connection = yield* socket.connect(options.clientId, (message) => Effect.gen(function*() {
    if (message.evt === 'READY') yield* Deferred.succeed(ready, undefined);
    if (message.evt === 'VOICE_SETTINGS_UPDATE' || (typeof message.nonce === 'string' && voiceRequests.has(message.nonce))) {
      const decoded = yield* Schema.decodeUnknownEffect(settings)(message.data).pipe(Effect.result);
      if (Result.isSuccess(decoded)) yield* Ref.set(voice, Option.some(decoded.success));
    }
    if (typeof message.nonce === 'string') {
      const data = typeof message.data === 'object' && message.data !== null && !Array.isArray(message.data) ? message.data as Record<string, unknown> : {};
      yield* replies.reply(message.nonce, message.evt === 'ERROR' ? rpcError(typeof message.cmd === 'string' && /^[A-Z_]+$/.test(message.cmd) ? message.cmd : 'COMMAND', data) : data);
    }
  }));
  yield* Effect.raceFirst(Deferred.await(ready), connection.failure).pipe(Effect.timeout('5 seconds'));
  const request = (cmd: string, args: Record<string, unknown> = {}, evt?: string) => Effect.gen(function*() {
    const nonce = yield* crypto.randomUUIDv4();
    if (cmd === 'GET_VOICE_SETTINGS' || cmd === 'SET_VOICE_SETTINGS') voiceRequests.add(nonce);
    return yield* replies.call(nonce, connection.send({ cmd, args, nonce, ...(evt ? { evt } : {}) }), connection.failure).pipe(Effect.ensuring(Effect.sync(() => { voiceRequests.delete(nonce); })));
  }).pipe(Effect.mapError((error) => error instanceof IntegrationError ? error : new IntegrationError({ message: 'La requête RPC Discord a échoué.' })));
  yield* request('AUTHENTICATE', { access_token: Redacted.value(options.accessToken) });
  yield* request('SUBSCRIBE', {}, 'VOICE_SETTINGS_UPDATE');
  const current = request('GET_VOICE_SETTINGS').pipe(Effect.flatMap(Schema.decodeUnknownEffect(settings)), Effect.mapError((cause) => cause instanceof IntegrationError ? cause : new IntegrationError({ message: 'Réglages vocaux Discord indisponibles.' })));
  const toggle = (field: 'mute' | 'deaf') => Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
    const before = yield* current;
    yield* request('SET_VOICE_SETTINGS', { [field]: !before[field] });
    return yield* current;
  }));
  yield* current;
  const cached = Effect.flatMap(Ref.get(voice), Option.match({ onSome: Effect.succeed, onNone: () => Effect.fail(new IntegrationError({ message: 'État vocal Discord inconnu.' })) }));
  // Events give immediate updates; the read-only poll also recovers partial/missed events.
  const monitor = Effect.forever(Effect.sleep('2 seconds').pipe(Effect.andThen(current)));
  return { current, toggle, voice: cached, failure: Effect.raceFirst(connection.failure, monitor) };
}).pipe(Effect.mapError((error) => error instanceof IntegrationError ? error : new IntegrationError({ message: 'Connexion RPC Discord échouée.' })));
export interface Controller {
  readonly current: Effect.Effect<Message, IntegrationError>;
  readonly toggle: (field: 'mute' | 'deaf') => Effect.Effect<Message, IntegrationError>;
  readonly failure: Effect.Effect<never, IntegrationError>;
  readonly voice?: Effect.Effect<VoiceState, IntegrationError>;
}
export const configured = Effect.gen(function*() {
  const backend = yield* Config.Literals(['auto', 'keyboard', 'rpc'], 'STREAMDECK_DISCORD_BACKEND').pipe(Config.withDefault('rpc'));
  if (backend === 'keyboard') return yield* makeDiscordKeys;
  const saved = yield* Effect.serviceOption(DiscordConnection);
  if (Option.isSome(saved)) { const options = yield* saved.value.options; if (options) return yield* make(options); }
  const clientId = yield* Config.String('STREAMDECK_DISCORD_CLIENT_ID').pipe(Config.option);
  const accessToken = yield* Config.Redacted('STREAMDECK_DISCORD_ACCESS_TOKEN').pipe(Config.option);
  if ((backend === 'auto' && Option.isNone(clientId) && Option.isNone(accessToken))) return yield* makeDiscordKeys;
  if (Option.isNone(clientId) || Option.isNone(accessToken)) return yield* Effect.fail(new IntegrationError({ message: 'Connexion RPC Discord à configurer : application autorisée et autorisation OAuth nécessaires. Le bouton affichera HORS LIGNE jusqu’à la connexion.' }));
  return yield* make({ clientId: clientId.value, accessToken: accessToken.value });
});
export class Discord extends Context.Service<Discord, Controller>()('@nixfiles/streamdeck/Discord') {
  static readonly layer = Layer.effect(Discord, configured).pipe(Layer.provide(Layer.mergeAll(DiscordTransport.layer, DesktopKeys.layer, DiscordOAuth.layer)));
}
const input = Plugin.NoInput;
const liveFeedback = (api: Controller, field: 'mute' | 'deaf'): Effect.Effect<KeyFeedback, IntegrationError> => Effect.gen(function*() {
  const voice = yield* api.voice ?? Effect.fail(new IntegrationError({ message: 'Ce backend ne fournit pas l’état vocal réel.' }));
  const muted = field === 'mute' ? voice.mute || voice.deaf : voice.deaf;
  return { icon: field === 'mute' ? 'microphone' : 'headphones', tone: muted ? 'danger' : 'positive', text: muted ? 'COUPÉ' : 'ACTIF' };
});
export const plugin = Plugin.fromLayer({
  id: 'discord', name: 'Discord', description: 'RPC direct sans changement de focus, avec état mute/deafen synchronisé sur les touches.', controls: {}, service: Discord, layer: Discord.layer, run: (api) => api.failure,
  actions: [
    Plugin.action({ id: 'status', name: 'Connexion Discord', description: 'Affiche la connexion active. L’état mute/deafen est disponible uniquement en RPC.', input, defaults: {}, run: (api: Controller) => api.current }),
    Plugin.action({ id: 'mute', name: 'Mute Discord', description: 'Bascule le mute du micro Discord ; la touche suit l’état réel.', input, defaults: {}, run: (api: Controller) => api.toggle('mute'), feedback: (api) => liveFeedback(api, 'mute'), unavailable: { icon: 'microphone', tone: 'neutral', text: 'HORS LIGNE' } }),
    Plugin.action({ id: 'deafen', name: 'Deafen Discord', description: 'Bascule le deafen Discord ; la touche suit l’état réel.', input, defaults: {}, run: (api: Controller) => api.toggle('deaf'), feedback: (api) => liveFeedback(api, 'deaf'), unavailable: { icon: 'headphones', tone: 'neutral', text: 'HORS LIGNE' } }),
  ],
});
/** Discord has no documented RPC command for screen sharing. An explicit bridge owns that operation. */
export const screenSharePlugin = Plugin.define({
  id: 'discord-screen-share', name: 'Discord · partage d’écran', description: 'Appelle ton script de partage d’écran ; aucune commande RPC officielle ne l’expose.', controls: {},
  setup: Effect.gen(function*() { const run = yield* commandFromConfig('STREAMDECK_DISCORD_SCREEN_SHARE'); return { api: { run } }; }),
  actions: [Plugin.action({ id: 'share-screen', name: 'Partager l’écran', description: 'Exécute le bridge configuré explicitement.', input, defaults: {}, run: (api: { run: Effect.Effect<string, IntegrationError> }) => api.run })],
});
