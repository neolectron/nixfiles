import { Clock, Context, Crypto, Deferred, Effect, FileSystem, Layer, Path, Redacted, Schema, Semaphore } from 'effect';
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http';
import { IntegrationError, requests } from './json-socket.ts';
import { DiscordTransport } from './discord-ipc.ts';
import { AppInput } from './discord-contract.ts';
const Token = Schema.Struct({ access_token: Schema.NonEmptyString, refresh_token: Schema.NonEmptyString, expires_in: Schema.Number.check(Schema.isGreaterThan(0)) });
const Stored = Schema.Struct({ version: Schema.Literal(1), clientId: Schema.String, clientSecret: Schema.String,
  token: Schema.optional(Schema.Struct({ access: Schema.String, refresh: Schema.String, expiresAt: Schema.Number })),
});
type Stored = typeof Stored.Type;
const error = (message: string) => new IntegrationError({ message });

/** OAuth secrets stay in the service and mode-0600 file; public snapshots never return them. */
export class DiscordOAuth extends Context.Service<DiscordOAuth, {
  readonly exchange: (clientId: string, secret: Redacted.Redacted<string>, grant: { code: string } | { refresh: Redacted.Redacted<string> }) => Effect.Effect<typeof Token.Type, IntegrationError>;
}>()('@nixfiles/streamdeck/DiscordOAuth') {
  static readonly layer = Layer.succeed(DiscordOAuth, {
    exchange: (clientId, secret, grant) => Effect.scoped(Effect.gen(function*() {
      const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
      const request = HttpClientRequest.post('https://discord.com/api/oauth2/token').pipe(HttpClientRequest.bodyUrlParams({ client_id: clientId, client_secret: Redacted.value(secret),
        ...('code' in grant ? { grant_type: 'authorization_code', code: grant.code } : { grant_type: 'refresh_token', refresh_token: Redacted.value(grant.refresh) }),
      }));
      const response = yield* client.execute(request);
      return yield* response.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Token)));
    })).pipe(Effect.timeout('10 seconds'), Effect.mapError(() => error('Échange OAuth Discord refusé. Vérifie le secret et les autorisations RPC de l’application.')), Effect.provide(FetchHttpClient.layer)),
  });
}

export const authorize = (clientId: string) => Effect.scoped(Effect.gen(function*() {
  const socket = yield* DiscordTransport; const crypto = yield* Crypto.Crypto; const replies = yield* requests;
  const ready = yield* Deferred.make<void, IntegrationError>();
  const connection = yield* socket.connect(clientId, (frame) => Effect.gen(function*() {
    if (frame.evt === 'READY') yield* Deferred.succeed(ready, undefined);
    if (typeof frame.nonce === 'string') yield* replies.reply(frame.nonce, frame.evt === 'ERROR' ? error('Autorisation RPC refusée par Discord. L’application doit autoriser ton compte comme testeur ou disposer de l’accès RPC.') : typeof frame.data === 'object' && frame.data !== null ? frame.data as Record<string, unknown> : {});
  }));
  yield* Effect.raceFirst(Deferred.await(ready), connection.failure).pipe(Effect.timeout('5 seconds'));
  const nonce = yield* crypto.randomUUIDv4();
  const result = yield* replies.call(nonce, connection.send({ cmd: 'AUTHORIZE', nonce, args: { client_id: clientId, scopes: ['rpc', 'identify'] } }), connection.failure, '2 minutes');
  const data = yield* Schema.decodeUnknownEffect(Schema.Struct({ code: Schema.NonEmptyString }))(result);
  return data.code;
})).pipe(Effect.mapError((cause) => cause instanceof IntegrationError ? cause : error('Autorisation Discord interrompue ou réponse invalide.')));

export const make = (file: string) => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem; const path = yield* Path.Path; const crypto = yield* Crypto.Crypto; const lock = yield* Semaphore.make(1);
  let stored: Stored | undefined = (yield* fs.exists(file)) ? yield* fs.readFileString(file).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Stored))), Effect.mapError(() => error('Configuration Discord privée illisible.'))) : undefined;
  const save = (next: Stored) => Effect.gen(function*() {
    yield* fs.makeDirectory(path.dirname(file), { recursive: true }); const tmp = `${file}.${yield* crypto.randomUUIDv4()}.tmp`;
    yield* fs.writeFileString(tmp, JSON.stringify(next), { mode: 0o600 }).pipe(Effect.andThen(fs.rename(tmp, file)), Effect.ensuring(fs.remove(tmp, { force: true }).pipe(Effect.ignore)));
    stored = next;
  }).pipe(Effect.uninterruptible, Effect.mapError(() => error('Enregistrement de la connexion Discord impossible.')));
  const publicState = Effect.sync(() => ({ clientId: stored?.clientId ?? '', configured: !!stored?.clientSecret, authorized: !!stored?.token }));
  const saveToken = (app: Stored, token: typeof Token.Type) => Effect.flatMap(Clock.currentTimeMillis, (now) => save({ ...app, token: { access: token.access_token, refresh: token.refresh_token, expiresAt: now + token.expires_in * 1000 } }));
  return {
    publicState,
    configure: (input: typeof AppInput.Type) => Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
      const secret = input.clientSecret ?? (input.clientId === stored?.clientId ? stored.clientSecret : undefined);
      if (!secret) return yield* Effect.fail(error('Le secret de cette application est nécessaire pour OAuth.'));
      yield* save({ version: 1, clientId: input.clientId, clientSecret: secret });
    })),
    connect: Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
      const app = stored; if (!app) return yield* Effect.fail(error('Renseigne d’abord l’application Discord.'));
      const code = yield* authorize(app.clientId);
      const token = yield* (yield* DiscordOAuth).exchange(app.clientId, Redacted.make(app.clientSecret), { code });
      yield* saveToken(app, token);
    })),
    options: Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
      if (!stored) return undefined;
      const app = stored; if (!app.token) return yield* Effect.fail(error('Clique Autoriser dans Discord pour connecter cette application.'));
      if (app.token.expiresAt <= (yield* Clock.currentTimeMillis) + 60_000) {
        const token = yield* (yield* DiscordOAuth).exchange(app.clientId, Redacted.make(app.clientSecret), { refresh: Redacted.make(app.token.refresh) });
        yield* saveToken(app, token);
      }
      return { clientId: stored!.clientId, accessToken: Redacted.make(stored!.token!.access) };
    })),
  };
});
export class DiscordConnection extends Context.Service<DiscordConnection, Effect.Success<ReturnType<typeof make>>>()('@nixfiles/streamdeck/DiscordConnection') {
  static readonly layer = (file: string) => Layer.effect(DiscordConnection, make(file));
}
