import { invariant } from '../errors.ts';
import { Config, Effect, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { IntegrationError } from '../json-socket.ts';
/** Explicit literal argv bridges; no shell interpolation, secret fields or automatic execution. */
export const commandFromConfig = (name: string) =>
  Effect.gen(function* () {
    const argv = yield* Config.schema(
      Schema.fromJsonString(Schema.Array(Schema.String).check(Schema.isMinLength(1))),
      name,
    ).pipe(
      Effect.mapError(
        () =>
          new IntegrationError({
            message: `Configure ${name} avec un tableau JSON [exécutable, arguments…].`,
          }),
      ),
    );
    if (!argv[0])
      return yield* Effect.fail(
        new IntegrationError({ message: `${name} doit contenir un exécutable.` }),
      );
    const processes = yield* ChildProcessSpawner.ChildProcessSpawner;
    return Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* processes.spawn(
          ChildProcess.make(invariant(argv[0], 'command-bridge'), argv.slice(1), {
            stdin: 'ignore',
          }),
        );
        const [code] = yield* Effect.all(
          [handle.exitCode, Stream.runDrain(handle.stdout), Stream.runDrain(handle.stderr)],
          { concurrency: 'unbounded' },
        );
        if (code !== 0)
          return yield* Effect.fail(
            new IntegrationError({ message: `${name} s’est terminé avec le code ${code}.` }),
          );
        return 'Bridge exécuté.';
      }),
    ).pipe(
      Effect.timeout('5 seconds'),
      Effect.mapError((error) =>
        error instanceof IntegrationError
          ? error
          : new IntegrationError({ message: `Le bridge ${name} a échoué ou dépassé son délai.` }),
      ),
    );
  });
