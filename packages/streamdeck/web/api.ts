import { Data, Effect, Result, Schedule, Schema, Stream } from 'effect';
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http';
import { Sse } from 'effect/encoding';
import * as Sync from '../src/studio-sync.ts';
import { Note, Update as NoteUpdate } from '@nixfiles/system-control/notes-contract.ts';
import { Activity } from '@nixfiles/system-control/speech-contract.ts';
import { Catalogue, Snapshot, type DialInput, type UpdateProfile } from '../src/studio-contract.ts';
import type { AppInput } from '@nixfiles/system-control/discord-contract.ts';
import type * as LcdLayout from '../src/lcd-layout.ts';
class RequestError extends Data.TaggedError('RequestError')<{
  readonly message: string;
}> {}
/** Preserve domain errors at the React boundary instead of displaying FiberFailure stack traces. */
export const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(Effect.result(effect)).then((result) => {
    if (Result.isFailure(result)) throw result.failure;
    return result.success;
  });
const json = (path: string, method: 'GET' | 'PUT' | 'POST' = 'GET', body?: unknown) =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const request = HttpClientRequest.make(method)(path).pipe(
        HttpClientRequest.setHeader('x-streamdeck-studio', '1'),
      );
      const response = yield* client.execute(
        body === undefined ? request : request.pipe(HttpClientRequest.bodyJsonUnsafe(body)),
      );
      const result = yield* response.json;
      if (response.status >= 400)
        return yield* Effect.fail(
          new RequestError({
            message:
              typeof result === 'object' &&
              result !== null &&
              'message' in result &&
              typeof result.message === 'string'
                ? result.message
                : `La requête a échoué (${response.status}).`,
          }),
        );
      return result;
    }),
  ).pipe(Effect.provide(FetchHttpClient.layer));
export const readNote = (id: string) =>
  json(`/api/notes?id=${encodeURIComponent(id)}`).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ note: Note, activity: Activity }))),
  );
export const saveNote = (input: typeof NoteUpdate.Type) =>
  json('/api/notes', 'PUT', input).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Note)));
export const dialInput = (input: typeof DialInput.Type) =>
  json('/api/dial-input', 'POST', input).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Snapshot)));
export const catalogue = json('/api/catalogue').pipe(
  Effect.flatMap(Schema.decodeUnknownEffect(Catalogue)),
);
export const choices = (action: string, field: string) =>
  json(
    `/api/system/choices?action=${encodeURIComponent(action)}&field=${encodeURIComponent(field)}`,
  ).pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(
        Schema.Array(Schema.Struct({ value: Schema.String, label: Schema.String })),
      ),
    ),
  );
const IntegrationList = Schema.Array(Schema.Struct({ id: Schema.String, enabled: Schema.Boolean }));
export const integrations = json('/api/system/integrations').pipe(
  Effect.flatMap(Schema.decodeUnknownEffect(IntegrationList)),
);
export const setIntegration = (id: string, enabled: boolean) =>
  json('/api/system/integrations', 'POST', { id, enabled }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(IntegrationList)),
  );
export const diagnostics = json('/api/system/diagnostics').pipe(
  Effect.flatMap(
    Schema.decodeUnknownEffect(
      Schema.Array(
        Schema.Struct({
          sequence: Schema.Int,
          action: Schema.String,
          startedAt: Schema.Number,
          durationMs: Schema.Number,
          outcome: Schema.Literals(['success', 'failure', 'cancelled']),
        }),
      ),
    ),
  ),
);
export const saveProfile = (input: typeof UpdateProfile.Type) =>
  json('/api/profile', 'PUT', input).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Snapshot)));
export const cancel = (key: number, address: string) =>
  json('/api/cancel', 'POST', { key, address }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Snapshot)),
  );
export const trigger = (key: number, address: string) =>
  json('/api/trigger', 'POST', { key, address }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Snapshot)),
  );
export const release = (key: number, address: string) =>
  json('/api/release', 'POST', { key, address }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Snapshot)),
  );
export const keyInput = (
  key: number,
  phase: 'down' | 'up' | 'cancel',
  address: string,
  revision: number,
  owner?: string,
) =>
  json('/api/key-input', 'POST', {
    key,
    phase,
    address,
    revision,
    ...(owner ? { owner } : {}),
  }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Snapshot)));
export const setPlugin = (id: string, enabled: boolean, expected: boolean) =>
  json('/api/plugin', 'POST', { id, enabled, expected }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Snapshot)),
  );
export const page = (direction: number) =>
  json('/api/page', 'POST', { direction }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Snapshot)),
  );
export const lcdTap = (dial: number, application: string, candidatePage: number) =>
  json('/api/lcd-tap', 'POST', { dial, application, page: candidatePage }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Snapshot)),
  );
export const lcdInput = (input: typeof LcdLayout.Input.Type) =>
  json('/api/lcd-input', 'POST', input).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Snapshot)));
export const lcdNavigate = (input: LcdLayout.Command) =>
  json('/api/lcd-navigation', 'POST', input).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Snapshot)),
  );
export const configureDiscord = (input: typeof AppInput.Type) =>
  json('/api/discord/connection', 'PUT', input).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Snapshot)),
  );
export const authorizeDiscord = json('/api/discord/authorize', 'POST').pipe(
  Effect.flatMap(Schema.decodeUnknownEffect(Snapshot)),
);
/** Browser fetch/SSE, schema validation, reconnection and cancellation all use Effect. */
export const observe = (onSnapshot: (snapshot: Snapshot) => void, onOffline: () => void) =>
  Effect.scoped(
    Effect.suspend(() => {
      let previous: Snapshot | undefined;
      return HttpClientResponse.stream(HttpClient.get('/api/events')).pipe(
        Stream.decodeText,
        Stream.pipeThroughChannel(Sse.decodeDataSchema(Sync.Event)),
        Stream.runForEach(({ data }) =>
          Effect.try({
            try: () => {
              previous = Sync.apply(previous, data);
              onSnapshot(previous);
            },
            catch: () => new RequestError({ message: 'Resynchronisation du deck.' }),
          }),
        ),
      );
    }),
  ).pipe(
    Effect.andThen(Effect.fail(new RequestError({ message: 'Connexion interrompue.' }))),
    Effect.tapError(() => Effect.sync(onOffline)),
    Effect.retry(Schedule.spaced(1000)),
    Effect.provide(FetchHttpClient.layer),
  );
