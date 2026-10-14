import { Effect, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { IntegrationError } from './errors.ts';

/** Read names/transport kinds only; no server is initialized or configuration logged.
 * Managed MCP tables survive --ignore-user-config and an empty-table override.
 */
export const disabledMcp = (executable: string, directory: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const processes = yield* ChildProcessSpawner.ChildProcessSpawner;
      const listing = yield* processes.spawn(
        ChildProcess.make(executable, ['mcp', 'list', '--json'], {
          cwd: directory,
          stdin: 'ignore',
          forceKillAfter: '1 second',
        }),
      );
      const [code, raw] = yield* Effect.all(
        [
          listing.exitCode,
          Stream.mkString(Stream.decodeText(listing.stdout)),
          Stream.runDrain(listing.stderr),
        ],
        { concurrency: 'unbounded' },
      );
      if (code !== 0)
        return yield* new IntegrationError({
          message: 'Lecture de la configuration Codex impossible.',
        });
      const servers = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(
          Schema.Array(
            Schema.Struct({
              name: Schema.String,
              transport: Schema.Struct({ type: Schema.Literals(['stdio', 'streamable_http']) }),
            }),
          ),
        ),
      )(raw);
      return `{${servers.map(({ name, transport }) => `${JSON.stringify(name)}={enabled=false,${transport.type === 'stdio' ? 'command="false"' : 'url="http://127.0.0.1:1"'}}`).join(',')}}`;
    }),
  );
