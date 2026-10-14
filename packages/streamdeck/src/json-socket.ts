import { NodeSocket } from '@effect/platform-node';
import { Context, Data, Deferred, Effect, Layer, Scope, Schema, type Duration } from 'effect';
import { Socket } from 'effect/socket';

export class IntegrationError extends Data.TaggedError('IntegrationError')<{ readonly message: string }> {}
export type Message = Readonly<Record<string, unknown>>;
const decode = Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Unknown));
export interface Connection {
  readonly send: (message: Message) => Effect.Effect<void, IntegrationError>;
  readonly failure: Effect.Effect<never, IntegrationError>;
}
/** Small transport seam: protocols own routing/authentication; tests replace this Layer. */
export class JsonSocket extends Context.Service<JsonSocket, {
  readonly connect: (url: string, receive: (message: Message) => Effect.Effect<void, IntegrationError>) => Effect.Effect<Connection, IntegrationError, Scope.Scope>;
}>()('@nixfiles/streamdeck/JsonSocket') {
  static readonly layer = Layer.succeed(JsonSocket, {
    connect: (url, receive) => Effect.gen(function*() {
      const failed = yield* Deferred.make<never, IntegrationError>();
      const socket = yield* Socket.makeWebSocket(url, { openTimeout: '3 seconds', highWaterMark: 1024 * 1024 });
      const reader = yield* socket.reader;
      const writer = yield* socket.writer;
      yield* Effect.forkScoped(Effect.forever(Effect.gen(function*() {
        for (const frame of yield* reader.pull) {
          const value = yield* Effect.try({ try: () => JSON.parse(typeof frame === 'string' ? frame : new TextDecoder().decode(frame)), catch: () => new IntegrationError({ message: 'Message WebSocket JSON invalide.' }) });
          yield* receive(yield* decode(value).pipe(Effect.mapError(() => new IntegrationError({ message: 'Message WebSocket invalide.' }))));
        }
      })).pipe(Effect.catchCause(() => Deferred.fail(failed, new IntegrationError({ message: 'Connexion WebSocket fermée ou protocole invalide.' })) )));
      return { send: (message: Message) => writer.write(JSON.stringify(message)).pipe(Effect.mapError(() => new IntegrationError({ message: 'Écriture WebSocket impossible.' }))), failure: Deferred.await(failed) };
    }).pipe(Effect.mapError(() => new IntegrationError({ message: 'Connexion WebSocket impossible. Vérifie que l’application et son serveur sont démarrés.' })), Effect.provide(NodeSocket.layerWebSocketConstructor)),
  });
}

/** Bound outstanding requests and always remove them after timeout/cancellation. */
export const requests = Effect.gen(function*() {
  const pending = new Map<string, Deferred.Deferred<Message, IntegrationError>>();
  return {
    reply: (id: string, value: Message | IntegrationError) => Effect.suspend(() => {
      const waiter = pending.get(id);
      return !waiter ? Effect.void : value instanceof IntegrationError ? Deferred.fail(waiter, value).pipe(Effect.asVoid) : Deferred.succeed(waiter, value).pipe(Effect.asVoid);
    }),
    call: (id: string, send: Effect.Effect<void, IntegrationError>, failure: Effect.Effect<never, IntegrationError>, timeout: Duration.Input = '5 seconds') => Effect.gen(function*() {
      if (pending.size >= 64) return yield* Effect.fail(new IntegrationError({ message: 'Trop de requêtes en attente.' }));
      const waiter = yield* Deferred.make<Message, IntegrationError>();
      pending.set(id, waiter);
      return yield* send.pipe(Effect.andThen(Effect.raceFirst(Deferred.await(waiter), failure)), Effect.timeout(timeout), Effect.mapError((error) => error instanceof IntegrationError ? error : new IntegrationError({ message: 'Requête refusée, connexion perdue ou délai dépassé.' })), Effect.ensuring(Effect.sync(() => { pending.delete(id); })));
    }),
  };
});
