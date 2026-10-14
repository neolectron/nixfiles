import { Config, Context, Crypto, Deferred, Effect, Layer, Redacted, Schema } from 'effect';
import { Base64 } from 'effect/encoding';
import { IntegrationError } from '@nixfiles/system-control/errors.ts';
import { JsonSocket, requests, type Message } from '@nixfiles/system-control/json-socket.ts';
import * as Plugin from '../plugin.ts';

const Frame = Schema.Struct({ op: Schema.Number, d: Schema.Record(Schema.String, Schema.Unknown) });
const authSchema = Schema.Struct({ salt: Schema.String, challenge: Schema.String });
const responseSchema = Schema.Struct({
  requestId: Schema.String,
  requestStatus: Schema.Struct({ result: Schema.Boolean, comment: Schema.optional(Schema.String) }),
  responseData: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
const invalid = () => new IntegrationError({ message: 'Réponse OBS invalide.' });
export const authentication = (
  password: Redacted.Redacted<string>,
  salt: string,
  challenge: string,
) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const hash = (text: string) =>
      crypto.digest('SHA-256', new TextEncoder().encode(text)).pipe(Effect.map(Base64.encode));
    return yield* hash((yield* hash(Redacted.value(password) + salt)) + challenge);
  });
export const make = (options: {
  readonly url: string;
  readonly password: Redacted.Redacted<string>;
}) =>
  Effect.gen(function* () {
    const transport = yield* JsonSocket;
    const crypto = yield* Crypto.Crypto;
    const replies = yield* requests;
    const hello = yield* Deferred.make<Message, IntegrationError>();
    const ready = yield* Deferred.make<void, IntegrationError>();
    const connection = yield* transport.connect(options.url, (message) =>
      Effect.gen(function* () {
        const frame = yield* Schema.decodeUnknownEffect(Frame)(message).pipe(
          Effect.mapError(invalid),
        );
        if (frame.op === 0) yield* Deferred.succeed(hello, frame.d);
        else if (frame.op === 2) yield* Deferred.succeed(ready, undefined);
        else if (frame.op === 7) {
          const response = yield* Schema.decodeUnknownEffect(responseSchema)(frame.d).pipe(
            Effect.mapError(invalid),
          );
          yield* replies.reply(
            response.requestId,
            response.requestStatus.result
              ? (response.responseData ?? {})
              : new IntegrationError({
                  message: response.requestStatus.comment ?? 'Requête OBS refusée.',
                }),
          );
        }
      }),
    );
    const greeting = yield* Effect.raceFirst(Deferred.await(hello), connection.failure).pipe(
      Effect.timeout('5 seconds'),
    );
    const auth =
      greeting.authentication === undefined
        ? undefined
        : yield* Schema.decodeUnknownEffect(authSchema)(greeting.authentication).pipe(
            Effect.mapError(invalid),
          );
    yield* connection.send({
      op: 1,
      d: {
        rpcVersion: 1,
        eventSubscriptions: 0,
        ...(auth
          ? { authentication: yield* authentication(options.password, auth.salt, auth.challenge) }
          : {}),
      },
    });
    yield* Effect.raceFirst(Deferred.await(ready), connection.failure).pipe(
      Effect.timeout('5 seconds'),
    );
    const request = (requestType: string, requestData: Message = {}) =>
      Effect.gen(function* () {
        const requestId = yield* crypto.randomUUIDv4();
        return yield* replies.call(
          requestId,
          connection.send({ op: 6, d: { requestType, requestId, requestData } }),
          connection.failure,
        );
      });
    return { request, failure: connection.failure };
  }).pipe(
    Effect.mapError((error) =>
      error instanceof IntegrationError
        ? error
        : new IntegrationError({ message: 'Connexion/authentification OBS échouée.' }),
    ),
  );
export type Controller = Effect.Success<ReturnType<typeof make>>;
export class Obs extends Context.Service<Obs, Controller>()('@nixfiles/streamdeck/Obs') {
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
const empty = Plugin.NoInput;
const simple = (id: string, name: string, description: string, request: string) =>
  Plugin.action({
    id,
    name,
    description,
    input: empty,
    defaults: {},
    run: (api: Controller) => api.request(request),
  });
export const plugin = Plugin.fromLayer({
  id: 'obs',
  name: 'OBS Studio',
  description: 'Scènes, sources, enregistrement et diffusion via obs-websocket 5.',
  controls: {},
  service: Obs,
  layer: Obs.layer,
  run: (api) => api.failure,
  actions: [
    simple(
      'status',
      'État OBS',
      'Lit l’état de l’enregistrement, sans le démarrer.',
      'GetRecordStatus',
    ),
    simple(
      'record',
      'Enregistrement',
      'Démarre ou arrête l’enregistrement lors de l’appui.',
      'ToggleRecord',
    ),
    simple(
      'stream',
      'Diffusion',
      'Démarre ou arrête la diffusion lors de l’appui.',
      'ToggleStream',
    ),
    simple(
      'virtual-camera',
      'Caméra virtuelle',
      'Démarre ou arrête la caméra virtuelle.',
      'ToggleVirtualCam',
    ),
    simple(
      'save-replay',
      'Sauver le replay',
      'Sauve le replay si le buffer est déjà actif.',
      'SaveReplayBuffer',
    ),
    Plugin.action({
      id: 'scene',
      name: 'Changer de scène',
      description: 'Sélectionne la scène du programme.',
      input: Schema.Struct({ sceneName: Schema.NonEmptyString.annotate({ title: 'Scène' }) }),
      defaults: { sceneName: 'Scène' },
      run: (api: Controller, input) => api.request('SetCurrentProgramScene', input),
    }),
    Plugin.action({
      id: 'mute-input',
      name: 'Mute d’une source',
      description: 'Bascule le mute de la source audio OBS.',
      input: Schema.Struct({
        inputName: Schema.NonEmptyString.annotate({ title: 'Source audio' }),
      }),
      defaults: { inputName: 'Mic/Aux' },
      run: (api: Controller, input) => api.request('ToggleInputMute', input),
    }),
  ],
});
