import { Effect } from 'effect';
import type { NodeHttpServer } from '@effect/platform-node';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';

/** Keep HTTP/MCP on the same loopback listener as the editor in both modes. */
export const serveFrontend = (options: {
  root: string;
  port: number;
  production: boolean;
  handler: Effect.Success<ReturnType<typeof NodeHttpServer.makeHandler>>;
}) =>
  Effect.gen(function* () {
    const vite = yield* Effect.tryPromise(() => import('vite'));
    const attach = (server: Pick<ViteDevServer | PreviewServer, 'middlewares'>) => {
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split('?')[0] ?? '';
        return pathname.startsWith('/api/') || pathname === '/mcp'
          ? options.handler(request, response)
          : next();
      });
    };
    const config = {
      configFile: false as const,
      appType: 'mpa' as const,
      root: options.root,
      plugins: [
        {
          name: 'effect-studio-api',
          configureServer: attach,
          configurePreviewServer: attach,
          handleHotUpdate(context) {
            if (
              [
                'studio-contract.ts',
                'discord-contract.ts',
                'key-feedback.ts',
                'ui/key-card.ts',
              ].some((file) => context.file.endsWith(`/src/${file}`))
            )
              return [];
          },
        } satisfies Plugin,
      ],
    };
    const server = yield* Effect.acquireRelease(
      Effect.tryPromise(async () => {
        if (options.production)
          return vite.preview({
            ...config,
            build: { outDir: '../web-dist' },
            preview: { host: '127.0.0.1', port: options.port, strictPort: true, cors: false },
          });
        const candidate = await vite.createServer({
          ...config,
          server: { host: '127.0.0.1', port: options.port, strictPort: true },
        });
        try {
          await candidate.listen();
          return candidate;
        } catch (error) {
          await candidate.close();
          throw error;
        }
      }),
      (candidate) =>
        Effect.promise(async () => {
          if (candidate.httpServer && 'closeAllConnections' in candidate.httpServer)
            candidate.httpServer.closeAllConnections();
          await candidate.close();
        }),
    );
    return server;
  });
