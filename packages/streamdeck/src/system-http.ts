import { Effect, Schema } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse as Response } from 'effect/http';
import type { Controller } from '@nixfiles/system-control/actions.ts';
import * as Mcp from '@nixfiles/system-control/mcp.ts';
import type { Controller as Integrations } from '@nixfiles/system-control/integration-control.ts';

/** Transport adapter only; schemas, choices and execution belong to the system catalogue. */
export const register = (
  router: HttpRouter.HttpRouter,
  actions: Controller,
  origins: ReadonlyArray<string>,
  integrations?: Integrations,
) =>
  Effect.gen(function* () {
    if (integrations) {
      yield* router.add(
        'GET',
        '/api/system/integrations',
        Effect.map(integrations.snapshot, Response.jsonUnsafe),
      );
      yield* router.add(
        'POST',
        '/api/system/integrations',
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (
            !origins.includes(request.headers.origin ?? '') ||
            request.headers['x-streamdeck-studio'] !== '1'
          )
            return Response.empty({ status: 403 });
          const body = yield* request.json.pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(
                Schema.Struct({ id: Schema.String, enabled: Schema.Boolean }),
              ),
            ),
          );
          yield* integrations.set(body.id, body.enabled);
          return Response.jsonUnsafe(yield* integrations.snapshot);
        }).pipe(
          Effect.catch(() =>
            Effect.succeed(
              Response.jsonUnsafe({ message: 'Configuration invalide.' }, { status: 400 }),
            ),
          ),
        ),
      );
    }
    yield* router.add(
      'GET',
      '/api/system/actions',
      Effect.map(actions.catalogue, Response.jsonUnsafe),
    );
    yield* router.add(
      'GET',
      '/api/system/diagnostics',
      Effect.map(actions.diagnostics, Response.jsonUnsafe),
    );
    yield* router.add(
      'GET',
      '/api/system/choices',
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const query = new URL(request.url, 'http://localhost').searchParams;
        return Response.jsonUnsafe(
          yield* actions
            .choices(query.get('action') ?? '', query.get('field') ?? '')
            .pipe(Effect.orElseSucceed(() => [])),
        );
      }).pipe(
        Effect.catch(() =>
          Effect.succeed(Response.jsonUnsafe({ message: 'Requête invalide.' }, { status: 400 })),
        ),
      ),
    );
    yield* router.add(
      'POST',
      '/api/system/invoke',
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (
          !origins.includes(request.headers.origin ?? '') ||
          request.headers['x-streamdeck-studio'] !== '1'
        )
          return Response.jsonUnsafe({ message: 'Origine refusée.' }, { status: 403 });
        const body = yield* request.json.pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.Struct({ action: Schema.NonEmptyString, input: Schema.Json }),
            ),
          ),
        );
        return yield* actions.invoke(body.action, body.input).pipe(
          Effect.match({
            onSuccess: (result) => Response.jsonUnsafe({ result }),
            onFailure: (error) =>
              Response.jsonUnsafe(
                { message: error.message, code: error.code },
                {
                  status:
                    error.code === 'InvalidInput' ? 400 : error.code === 'Unknown' ? 404 : 503,
                },
              ),
          }),
        );
      }).pipe(
        Effect.catch(() =>
          Effect.succeed(Response.jsonUnsafe({ message: 'Requête invalide.' }, { status: 400 })),
        ),
      ),
    );
    yield* Mcp.http(actions, origins).pipe(Effect.provideService(HttpRouter.HttpRouter, router));
  });
