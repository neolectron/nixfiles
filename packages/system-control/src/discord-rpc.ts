import * as StateStore from './state.ts';
import { Crypto, Deferred, Effect, Redacted, Result, Schema, Semaphore } from 'effect';
import { IntegrationError } from './errors.ts';
import { requests } from './json-socket.ts';
import { DiscordTransport } from './discord-ipc.ts';
import { rpcError } from './discord-rpc-error.ts';
const settings = Schema.Struct({ mute: Schema.Boolean, deaf: Schema.Boolean });
export type VoiceState = typeof settings.Type;
export const make = (options: {
  readonly clientId: string;
  readonly accessToken: Redacted.Redacted<string>;
}) =>
  Effect.gen(function* () {
    const socket = yield* DiscordTransport;
    const crypto = yield* Crypto.Crypto;
    const replies = yield* requests;
    const lock = yield* Semaphore.make(1);
    const ready = yield* Deferred.make<void, IntegrationError>();
    const voice = yield* StateStore.make<VoiceState, IntegrationError>(
      new IntegrationError({ message: 'État vocal Discord inconnu.' }),
    );
    const voiceRequests = new Set<string>();
    const connection = yield* socket.connect(options.clientId, (message) =>
      Effect.gen(function* () {
        if (message.evt === 'READY') yield* Deferred.succeed(ready, undefined);
        if (
          message.evt === 'VOICE_SETTINGS_UPDATE' ||
          (typeof message.nonce === 'string' && voiceRequests.has(message.nonce))
        ) {
          const decoded = yield* Schema.decodeUnknownEffect(settings)(message.data).pipe(
            Effect.result,
          );
          if (Result.isSuccess(decoded)) yield* voice.publish(Result.succeed(decoded.success));
        }
        if (typeof message.nonce === 'string') {
          const data =
            typeof message.data === 'object' &&
            message.data !== null &&
            !Array.isArray(message.data)
              ? (message.data as Record<string, unknown>)
              : {};
          yield* replies.reply(
            message.nonce,
            message.evt === 'ERROR'
              ? rpcError(
                  typeof message.cmd === 'string' && /^[A-Z_]+$/.test(message.cmd)
                    ? message.cmd
                    : 'COMMAND',
                  data,
                )
              : data,
          );
        }
      }),
    );
    yield* Effect.raceFirst(Deferred.await(ready), connection.failure).pipe(
      Effect.timeout('5 seconds'),
    );
    const request = (cmd: string, args: Record<string, unknown> = {}, evt?: string) =>
      Effect.gen(function* () {
        const nonce = yield* crypto.randomUUIDv4();
        if (cmd === 'GET_VOICE_SETTINGS' || cmd === 'SET_VOICE_SETTINGS') voiceRequests.add(nonce);
        return yield* replies
          .call(
            nonce,
            connection.send({ cmd, args, nonce, ...(evt ? { evt } : {}) }),
            connection.failure,
          )
          .pipe(
            Effect.ensuring(
              Effect.sync(() => {
                voiceRequests.delete(nonce);
              }),
            ),
          );
      }).pipe(
        Effect.mapError((error) =>
          error instanceof IntegrationError
            ? error
            : new IntegrationError({ message: 'La requête RPC Discord a échoué.' }),
        ),
      );
    yield* request('AUTHENTICATE', { access_token: Redacted.value(options.accessToken) });
    yield* request('SUBSCRIBE', {}, 'VOICE_SETTINGS_UPDATE');
    const current = request('GET_VOICE_SETTINGS').pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(settings)),
      Effect.mapError((cause) =>
        cause instanceof IntegrationError
          ? cause
          : new IntegrationError({ message: 'Réglages vocaux Discord indisponibles.' }),
      ),
    );
    const toggle = (field: 'mute' | 'deaf') =>
      Semaphore.withPermits(
        lock,
        1,
      )(
        Effect.gen(function* () {
          const before = yield* current;
          yield* request('SET_VOICE_SETTINGS', { [field]: !before[field] });
          return yield* current;
        }),
      );
    yield* current;
    const cached = voice.state;
    // Events give immediate updates; the read-only poll also recovers partial/missed events.
    const monitor = Effect.forever(Effect.sleep('2 seconds').pipe(Effect.andThen(current)));
    return {
      current,
      toggle,
      voice: cached,
      observe: voice.observe,
      set: (field: 'mute' | 'deaf', value: boolean) =>
        Semaphore.withPermits(
          lock,
          1,
        )(
          Effect.gen(function* () {
            const before = yield* current;
            if (before[field] !== value) yield* request('SET_VOICE_SETTINGS', { [field]: value });
            return yield* current;
          }),
        ),
      failure: Effect.raceFirst(connection.failure, monitor),
    };
  }).pipe(
    Effect.mapError((error) =>
      error instanceof IntegrationError
        ? error
        : new IntegrationError({ message: 'Connexion RPC Discord échouée.' }),
    ),
  );
