import { Crypto, Deferred, Effect, Redacted, Schema } from 'effect';
import { Base64 } from 'effect/encoding';
import { IntegrationError } from './errors.ts';
import { JsonSocket, requests, type Message } from './json-socket.ts';
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
