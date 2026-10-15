import { assert, it } from '@effect/vitest';
import { NodeHttpServer } from '@effect/platform-node';
import { Effect, FileSystem, Layer } from 'effect';
import { FetchHttpClient, HttpClient, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { serveFrontend } from '../src/studio-server.ts';

it.live(
  'packaged frontend serves built assets and routes API and MCP through Effect on loopback',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-server-' });
        const root = `${directory}/web`;
        yield* fs.makeDirectory(root);
        yield* fs.makeDirectory(`${directory}/web-dist`);
        yield* fs.writeFileString(
          `${directory}/web-dist/index.html`,
          '<html>Packaged Studio</html>',
        );
        yield* fs.writeFileString(`${directory}/web-dist/app.js`, 'console.log("packaged")');
        const scope = yield* Effect.scope;
        const handler = yield* NodeHttpServer.makeHandler(
          Effect.map(HttpServerRequest.HttpServerRequest, (request) =>
            HttpServerResponse.jsonUnsafe({ routed: request.url }),
          ),
          { scope },
        );
        const server = yield* serveFrontend({ root, port: 0, production: true, handler });
        const address = server.httpServer?.address();
        assert.ok(address && typeof address !== 'string');
        assert.strictEqual(address.address, '127.0.0.1');
        const client = yield* HttpClient.HttpClient;
        const base = `http://127.0.0.1:${address.port}`;
        assert.match(yield* (yield* client.get(`${base}/`)).text, /Packaged Studio/);
        assert.match(yield* (yield* client.get(`${base}/app.js`)).text, /packaged/);
        assert.deepStrictEqual(yield* (yield* client.get(`${base}/api/state`)).json, {
          routed: '/api/state',
        });
        assert.deepStrictEqual(yield* (yield* client.get(`${base}/mcp?session=test`)).json, {
          routed: '/mcp?session=test',
        });
        assert.strictEqual((yield* client.get(`${base}/@vite/client`)).status, 404);
      }),
    ).pipe(Effect.provide(Layer.merge(FetchHttpClient.layer, NodeHttpServer.layerHttpServices))),
);
