import { Data, Effect, Schedule, Schema, Stream } from 'effect';
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http';
import { Sse } from 'effect/encoding';
import { Catalogue, Snapshot, type ButtonBinding, type Navigate, type Organize } from '../src/studio-contract.ts';

class RequestError extends Data.TaggedError('RequestError')<{ readonly message: string }> {}
const json = (path: string, method: 'GET' | 'PUT' | 'POST' = 'GET', body?: unknown) => Effect.scoped(Effect.gen(function*() {
  const client = yield* HttpClient.HttpClient;
  const request = HttpClientRequest.make(method)(path).pipe(HttpClientRequest.setHeader('x-streamdeck-studio', '1'));
  const response = yield* client.execute(body === undefined ? request : request.pipe(HttpClientRequest.bodyJsonUnsafe(body)));
  const result = yield* response.json;
  if (response.status >= 400) return yield* Effect.fail(new RequestError({ message: typeof result === 'object' && result !== null && 'message' in result && typeof result.message === 'string' ? result.message : `La requête a échoué (${response.status}).` }));
  return result;
})).pipe(Effect.provide(FetchHttpClient.layer));

export const catalogue = json('/api/catalogue').pipe(Effect.flatMap(Schema.decodeUnknownEffect(Catalogue)));
export const save = (key: number, binding: unknown, expected: ButtonBinding | null, address: string) => json('/api/binding', 'PUT', { key, binding, expected, address }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Snapshot)));
export const cancel = (key: number, address: string) => json('/api/cancel', 'POST', { key, address }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Snapshot)));
export const trigger = (key: number, address: string) => json('/api/trigger', 'POST', { key, address }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Snapshot)));
export const organize = (command: Organize) => json('/api/organize', 'POST', command).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Snapshot)));
export const navigate = (command: Navigate) => json('/api/navigate', 'POST', command).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Snapshot)));
export const page = (direction: number) => json('/api/page', 'POST', { direction }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Snapshot)));

/** Browser fetch/SSE, schema validation, reconnection and cancellation all use Effect. */
export const observe = (onSnapshot: (snapshot: Snapshot) => void, onOffline: () => void) => Effect.scoped(
  HttpClientResponse.stream(HttpClient.get('/api/events')).pipe(
    Stream.decodeText, Stream.pipeThroughChannel(Sse.decodeDataSchema(Snapshot)),
    Stream.runForEach(({ data }) => Effect.sync(() => onSnapshot(data))),
  ),
).pipe(Effect.andThen(Effect.fail(new RequestError({ message: 'Connexion interrompue.' }))),
  Effect.tapError(() => Effect.sync(onOffline)), Effect.retry(Schedule.spaced(1000)), Effect.provide(FetchHttpClient.layer));
