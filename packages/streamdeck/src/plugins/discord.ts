import * as SystemDiscord from '@nixfiles/system-control/discord.ts';
import type { VoiceState } from '@nixfiles/system-control/discord-rpc.ts';
import { Config, Context, Effect, Layer, Option } from 'effect';
import { IntegrationError } from '@nixfiles/system-control/errors.ts';
import type { Message } from '@nixfiles/system-control/json-socket.ts';
import { DiscordTransport } from '@nixfiles/system-control/discord-ipc.ts';
import * as Plugin from '../plugin.ts';
import { commandFromConfig } from './command-bridge.ts';
import { DesktopKeys, makeDiscordKeys } from '../desktop-keys.ts';
import type { KeyFeedback } from '../key-feedback.ts';
import { DiscordConnection, DiscordOAuth } from '@nixfiles/system-control/discord-connection.ts';

export interface Controller {
  readonly current: Effect.Effect<Message, IntegrationError>;
  readonly toggle: (field: 'mute' | 'deaf') => Effect.Effect<Message, IntegrationError>;
  readonly failure: Effect.Effect<never, IntegrationError>;
  readonly voice?: Effect.Effect<VoiceState, IntegrationError>;
  readonly shareScreen?: Effect.Effect<string, IntegrationError>;
}
const voiceConfigured = Effect.gen(function* () {
  const backend = yield* Config.Literals(
    ['auto', 'keyboard', 'rpc'],
    'STREAMDECK_DISCORD_BACKEND',
  ).pipe(Config.withDefault('rpc'));
  if (backend === 'keyboard') return yield* makeDiscordKeys;
  const shared = yield* Effect.serviceOption(SystemDiscord.Discord);
  if (Option.isSome(shared)) return { ...shared.value, failure: Effect.never };
  const saved = yield* Effect.serviceOption(DiscordConnection);
  if (Option.isSome(saved)) {
    const options = yield* saved.value.options;
    if (options)
      return { ...(yield* SystemDiscord.make(Effect.succeed(options))), failure: Effect.never };
  }
  const clientId = yield* Config.String('STREAMDECK_DISCORD_CLIENT_ID').pipe(Config.option);
  const accessToken = yield* Config.Redacted('STREAMDECK_DISCORD_ACCESS_TOKEN').pipe(Config.option);
  if (backend === 'auto' && Option.isNone(clientId) && Option.isNone(accessToken))
    return yield* makeDiscordKeys;
  if (Option.isNone(clientId) || Option.isNone(accessToken))
    return yield* Effect.fail(
      new IntegrationError({
        message:
          'Connexion RPC Discord à configurer : application autorisée et autorisation OAuth nécessaires. Le bouton affichera HORS LIGNE jusqu’à la connexion.',
      }),
    );
  return {
    ...(yield* SystemDiscord.make(
      Effect.succeed({ clientId: clientId.value, accessToken: accessToken.value }),
    )),
    failure: Effect.never,
  };
});
/** A missing bridge affects its action only; activation never starts screen sharing. */
export const configured = Effect.gen(function* () {
  const api = yield* voiceConfigured;
  const shareScreen = yield* commandFromConfig('STREAMDECK_DISCORD_SCREEN_SHARE').pipe(
    Effect.catch((cause) => Effect.succeed(Effect.fail(cause))),
  );
  return { ...api, shareScreen };
});
export class Discord extends Context.Service<Discord, Controller>()(
  '@nixfiles/streamdeck/Discord',
) {
  static readonly layer = Layer.effect(Discord, configured).pipe(
    Layer.provide(Layer.mergeAll(DiscordTransport.layer, DesktopKeys.layer, DiscordOAuth.layer)),
  );
}
const input = Plugin.NoInput;
const liveFeedback = (
  api: Controller,
  field: 'mute' | 'deaf',
): Effect.Effect<KeyFeedback, IntegrationError> =>
  Effect.gen(function* () {
    const voice = yield* (
      api.voice ??
        Effect.fail(
          new IntegrationError({ message: 'Ce backend ne fournit pas l’état vocal réel.' }),
        )
    );
    const muted = field === 'mute' ? voice.mute || voice.deaf : voice.deaf;
    return {
      icon: field === 'mute' ? 'microphone' : 'headphones',
      tone: muted ? 'danger' : 'positive',
      text: muted ? 'COUPÉ' : 'ACTIF',
    };
  });
export const plugin = Plugin.fromLayer({
  id: 'discord',
  name: 'Discord',
  description:
    'Mute/deafen avec état synchronisé en RPC et partage d’écran via un script configuré.',
  controls: {},
  service: Discord,
  layer: Discord.layer,
  run: (api) => api.failure,
  actions: [
    Plugin.action({
      id: 'status',
      name: 'Connexion Discord',
      description:
        'Affiche la connexion active. L’état mute/deafen est disponible uniquement en RPC.',
      input,
      defaults: {},
      run: (api: Controller) => api.current,
    }),
    Plugin.action({
      id: 'mute',
      name: 'Mute Discord',
      description: 'Bascule le mute du micro Discord ; la touche suit l’état réel.',
      input,
      defaults: {},
      run: (api: Controller) => api.toggle('mute'),
      feedback: (api) => liveFeedback(api, 'mute'),
      unavailable: { icon: 'microphone', tone: 'neutral', text: 'HORS LIGNE' },
    }),
    Plugin.action({
      id: 'deafen',
      name: 'Deafen Discord',
      description: 'Bascule le deafen Discord ; la touche suit l’état réel.',
      input,
      defaults: {},
      run: (api: Controller) => api.toggle('deaf'),
      feedback: (api) => liveFeedback(api, 'deaf'),
      unavailable: { icon: 'headphones', tone: 'neutral', text: 'HORS LIGNE' },
    }),
    Plugin.action({
      id: 'share-screen',
      name: 'Partager l’écran',
      description: 'Exécute le script défini par STREAMDECK_DISCORD_SCREEN_SHARE.',
      input,
      defaults: {},
      run: (api: Controller) =>
        api.shareScreen ??
        Effect.fail(
          new IntegrationError({
            message: 'Le script de partage d’écran Discord n’est pas configuré.',
          }),
        ),
    }),
  ],
});
