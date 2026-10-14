import { assert, it } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Ref,
  Result,
  Scope,
} from 'effect';
import { CodexBackend, CodexPrompt, codex, make } from '../src/codex-prompt.ts';
import { IntegrationError } from '../src/errors.ts';

const request = {
  prompt: 'Réponds bonjour.\nKeep this literal: $(false)',
  directory: '',
  access: 'read-only' as const,
};

it.effect(
  'prompt jobs validate without executing, reject overlapping calls and release busy state on cancellation',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const stopped = yield* Ref.make(0);
        const api = yield* make.pipe(
          Effect.provideService(CodexBackend, {
            run: () =>
              Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(Ref.update(stopped, (n) => n + 1)),
              ),
          }),
        );
        assert.strictEqual(yield* api.busy, false);
        assert.ok(Result.isFailure(yield* Effect.result(api.run({ ...request, prompt: '  ' }))));
        const job = yield* Effect.forkScoped(api.run(request));
        yield* Deferred.await(entered);
        assert.strictEqual(yield* api.busy, true);
        assert.ok(Result.isFailure(yield* Effect.result(api.run(request))));
        yield* Fiber.interrupt(job);
        assert.strictEqual(yield* api.busy, false);
        assert.strictEqual(yield* Ref.get(stopped), 1);
      }),
    ),
);

it.effect('prompt jobs return exact output and recover after a backend failure', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fail = yield* Ref.make(true);
      const seen: unknown[] = [];
      const api = yield* make.pipe(
        Effect.provideService(CodexBackend, {
          run: (input) =>
            Effect.sync(() => seen.push(input)).pipe(
              Effect.andThen(Ref.get(fail)),
              Effect.flatMap((bad) =>
                bad
                  ? Effect.fail(new IntegrationError({ message: 'Offline' }))
                  : Effect.succeed('Hello\nWorld.'),
              ),
            ),
        }),
      );
      assert.ok(Result.isFailure(yield* Effect.result(api.run(request))));
      assert.strictEqual(yield* api.busy, false);
      yield* Ref.set(fail, false);
      assert.strictEqual(yield* api.run(request), 'Hello\nWorld.');
      assert.deepStrictEqual(seen, [request, request]);
      assert.strictEqual(yield* api.busy, false);
    }),
  ),
);

it.effect('closing the prompt service cancels its job and revokes the retained API', () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const stopped = yield* Ref.make(false);
    const scope = yield* Scope.make();
    const services = yield* Layer.build(
      CodexPrompt.serviceLayer.pipe(
        Layer.provide(
          Layer.succeed(CodexBackend, {
            run: () =>
              Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(Ref.set(stopped, true)),
              ),
          }),
        ),
      ),
    ).pipe(Scope.provide(scope));
    const api = Context.get(services, CodexPrompt);
    const job = yield* Effect.forkChild(api.run(request));
    yield* Deferred.await(entered);
    yield* Scope.close(scope, Exit.void);
    yield* Fiber.await(job);
    assert.strictEqual(yield* Ref.get(stopped), true);
    assert.ok(Result.isFailure(yield* Effect.result(api.run(request))));
    assert.ok(Result.isFailure(yield* Effect.result(api.busy)));
  }),
);

const fake = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'prompt-test-' });
  const executable = `${root}/codex`;
  yield* fs.writeFileString(
    executable,
    `#!/bin/sh
if [ "$1" = mcp ]; then printf '%s' '[{"name":"example.server","transport":{"type":"stdio"}}]'; exit 0; fi
printf '%s\\n' "$@" > '${root}/args'
pwd > '${root}/cwd'
cat > '${root}/input'
while [ "$#" -gt 0 ]; do
  if [ "$1" = --output-last-message ]; then printf '%s' 'Response from Codex' > "$2"; printf '%s' "$2" > '${root}/output'; fi
  shift
done
`,
    { mode: 0o700 },
  );
  return { fs, root, api: yield* codex(executable) };
});

it.live(
  'prompt transport sends literal stdin, preserves its sandbox, disables MCP and cleans temporary files',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { fs, root, api } = yield* fake;
        assert.strictEqual(yield* api.run(request), 'Response from Codex');
        assert.strictEqual(yield* fs.readFileString(`${root}/input`), request.prompt);
        const args = yield* fs.readFileString(`${root}/args`);
        assert.include(args, '--ephemeral\n--ignore-user-config');
        assert.include(args, '--sandbox\nread-only');
        assert.include(args, '"example.server"={enabled=false,command="false"}');
        assert.strictEqual(args.includes(request.prompt), false);
        assert.strictEqual(
          yield* fs.exists((yield* fs.readFileString(`${root}/cwd`)).trim()),
          false,
        );
        assert.strictEqual(yield* fs.exists(yield* fs.readFileString(`${root}/output`)), false);
        yield* api.run({ ...request, directory: root, access: 'workspace-write' });
        assert.strictEqual((yield* fs.readFileString(`${root}/cwd`)).trim(), root);
        assert.include(yield* fs.readFileString(`${root}/args`), '--sandbox\nworkspace-write');
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.live(
  'prompt transport rejects missing/relative projects, implicit writes and empty replies',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { fs, root, api } = yield* fake;
        for (const input of [
          { ...request, directory: 'relative' },
          { ...request, directory: `${root}/missing` },
          { ...request, directory: `${root}/codex` },
          { ...request, access: 'workspace-write' as const },
        ])
          assert.ok(Result.isFailure(yield* Effect.result(api.run(input))));
        assert.strictEqual(yield* fs.exists(`${root}/args`), false);
        yield* fs.writeFileString(
          `${root}/codex`,
          `#!/bin/sh
if [ "$1" = mcp ]; then printf '[]'; exit 0; fi
while [ "$#" -gt 0 ]; do
  if [ "$1" = --output-last-message ]; then printf '' > "$2"; fi
  shift
done
`,
          { mode: 0o700 },
        );
        assert.ok(Result.isFailure(yield* Effect.result(api.run(request))));
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);
