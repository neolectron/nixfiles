import { assert, it } from '@effect/vitest';
import { NodeHttpServer, NodeServices } from '@effect/platform-node';
import { Effect, Layer, Ref, Schema } from 'effect';
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from 'effect/http';
import { make, define } from '@nixfiles/system-control/actions.ts';
import { register } from '../src/system-http.ts';

it.live(
  'HTTP and MCP discover and invoke the same scoped actions, validate input and reject foreign origins',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const total = yield* Ref.make(0);
        const actions = yield* make;
        yield* actions.register(
          define({
            id: 'test.add',
            name: 'Add',
            input: Schema.Struct({ n: Schema.Int }),
            output: Schema.Int,
            run: ({ n }) => Ref.updateAndGet(total, (before) => before + n),
          }),
        );
        const server = yield* HttpServer.HttpServer;
        if (server.address._tag === 'UnixPathAddress') throw new Error('Expected TCP');
        const base = `http://127.0.0.1:${server.address.port}`;
        yield* server.serve(
          yield* HttpRouter.toHttpEffect(
            HttpRouter.use((router) => register(router, actions, [base])),
          ),
        );
        const client = yield* HttpClient.HttpClient;
        let session = '';
        const post = (path: string, body: unknown, origin = base) =>
          client.execute(
            HttpClientRequest.post(path).pipe(
              HttpClientRequest.setHeaders(
                session ? { 'mcp-session-id': session, 'mcp-protocol-version': '2025-11-25' } : {},
              ),
              HttpClientRequest.setHeader('origin', origin),
              HttpClientRequest.setHeader('x-streamdeck-studio', '1'),
              HttpClientRequest.setHeader('accept', 'application/json, text/event-stream'),
              HttpClientRequest.bodyJsonUnsafe(body),
            ),
          );
        assert.strictEqual(
          (yield* post('/api/system/invoke', { action: 'test.add', input: { n: 2 } })).status,
          200,
        );
        assert.strictEqual(
          (yield* post('/api/system/invoke', { action: 'test.add', input: { n: 'bad' } })).status,
          400,
        );
        assert.strictEqual(
          (yield* post(
            '/api/system/invoke',
            { action: 'test.add', input: { n: 99 } },
            'https://foreign.example',
          )).status,
          403,
        );
        const rpc = (method: string, params: unknown, id = 1, origin = base) =>
          post('/mcp', { jsonrpc: '2.0', id, method, params }, origin);
        const init = yield* rpc('initialize', {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        });
        assert.strictEqual(init.status, 200);
        const initialized = yield* init.json.pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.Struct({ result: Schema.Struct({ protocolVersion: Schema.String }) }),
            ),
          ),
        );
        assert.strictEqual(initialized.result.protocolVersion, '2025-11-25');
        session = init.headers['mcp-session-id'] ?? '';
        assert.ok(session);
        assert.strictEqual(
          (yield* post('/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' })).status,
          202,
        );
        const list = yield* rpc('tools/list', {});
        const tools = yield* list.json.pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.Struct({
                result: Schema.Struct({
                  tools: Schema.Array(Schema.Struct({ name: Schema.String })),
                }),
              }),
            ),
          ),
        );
        assert.ok(tools.result.tools.some((tool) => tool.name === 'test.add'));
        const call = yield* rpc('tools/call', { name: 'test.add', arguments: { n: 3 } });
        assert.strictEqual(call.status, 200);
        assert.include(JSON.stringify(yield* call.json), '5');
        assert.strictEqual(yield* Ref.get(total), 5);
        assert.strictEqual(
          (yield* rpc(
            'tools/call',
            { name: 'test.add', arguments: { n: 99 } },
            1,
            'https://foreign.example',
          )).status,
          403,
        );
        assert.strictEqual(yield* Ref.get(total), 5);
        assert.strictEqual((yield* actions.diagnostics).length, 3);
      }),
    ).pipe(
      Effect.provide(Layer.merge(NodeServices.layer, NodeHttpServer.layerTest)),
      Effect.timeout('5 seconds'),
    ),
);
