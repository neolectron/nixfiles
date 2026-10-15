import { Context, Effect, Layer, Schema } from 'effect';
import { McpServer, McpProtocol, McpSchema } from 'effect/ai';
import { HttpRouter } from 'effect/http';
import type { Controller } from './actions.ts';

const jsonSchema = (document: unknown): unknown => {
  if (typeof document !== 'object' || document === null || !('schema' in document)) return document;
  return {
    ...(document.schema as object),
    ...('definitions' in document ? { definitions: document.definitions } : {}),
  };
};

/** MCP shares the exact action instances of the host; no second desktop/audio runtime. */
export const http = (actions: Controller, origins: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const router = yield* HttpRouter.HttpRouter;
    const services = yield* Layer.build(
      McpServer.layerHttp({
        name: 'system-control',
        version: '0.1.0',
        path: '/mcp',
        protocols: [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25, McpProtocol.v2025_03_26],
        allowedOrigins: [...origins],
        allowSessionTermination: false,
      }).pipe(Layer.provide(Layer.succeed(HttpRouter.HttpRouter, router))),
    );
    const server = Context.get(services, McpServer.McpServer);
    for (const action of yield* actions.catalogue) {
      const inputSchema = yield* Schema.decodeUnknownEffect(McpSchema.ToolJson)(
        jsonSchema(action.input),
      );
      const { definitions, ...output } = yield* Schema.decodeUnknownEffect(
        McpSchema.ToolOutputJson,
      )(jsonSchema(action.output));
      const outputSchema: McpSchema.ToolOutputJson = {
        type: 'object',
        properties: { result: output },
        required: ['result'],
        ...(definitions ? { definitions } : {}),
      };
      yield* server.addTool({
        tool: new McpSchema.Tool({
          name: action.id,
          title: action.name,
          description: action.description,
          inputSchema,
          outputSchema,
        }),
        annotations: Context.empty(),
        handle: (input: unknown) =>
          actions.invoke(action.id, input).pipe(
            Effect.match({
              onSuccess: (result) =>
                new McpSchema.CallToolResult({
                  content: [{ type: 'text', text: JSON.stringify(result) }],
                  structuredContent: { result },
                }),
              onFailure: (error) =>
                new McpSchema.CallToolResult({
                  isError: true,
                  content: [{ type: 'text', text: error.message }],
                }),
            }),
          ),
      });
    }
  });
