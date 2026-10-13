import { Config, Effect, Path, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

/** Literal argv, concurrent pipe draining and scoped cleanup for CLI integration tests. */
export const cli = (args: ReadonlyArray<string>, env: Record<string, string> = { LD_LIBRARY_PATH: '' }) =>
  Effect.scoped(Effect.gen(function*() {
    const node = yield* Config.String('npm_node_execpath');
    const path = yield* Path.Path;
    const cwd = yield* path.fromFileUrl(new URL('..', import.meta.url));
    const processes = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* processes.spawn(ChildProcess.make(node, ['src/cli.ts', ...args], { cwd, env, extendEnv: true }));
    const [stdout, stderr, status] = yield* Effect.all([
      Stream.mkString(Stream.decodeText(handle.stdout)),
      Stream.mkString(Stream.decodeText(handle.stderr)),
      handle.exitCode,
    ], { concurrency: 'unbounded' });
    return { stdout, stderr, status };
  })).pipe(Effect.timeout('10 seconds'));
