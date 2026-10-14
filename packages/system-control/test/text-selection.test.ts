import { assert, it } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import {
  Context,
  Deferred,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Ref,
  Result,
  Scope,
  Exit,
} from 'effect';
import { TextTransform, TextModel, codex } from '../src/text-transform.ts';
import { SelectionBackend, make, wayland, type Selection } from '../src/text-selection.ts';
import { IntegrationError } from '../src/errors.ts';

const original = { window: 7, text: '  Bonjour 👋\nLe monde.  ' };
const setup = (
  transform: (text: string, prompt: string) => Effect.Effect<string, IntegrationError>,
) =>
  Effect.gen(function* () {
    const pasted: Array<{ selection: Selection; text: string }> = [];
    let captures = 0;
    const api = yield* make.pipe(
      Effect.provide(
        Layer.merge(
          Layer.succeed(SelectionBackend, {
            capture: Effect.sync(() => {
              captures++;
              return original;
            }),
            replace: (selection, text) =>
              Effect.sync(() => {
                pasted.push({ selection, text });
              }),
          }),
          Layer.succeed(TextTransform, {
            transform: (request) => transform(request.text, request.prompt),
          }),
        ),
      ),
    );
    return { api, pasted, captures: () => captures };
  });

it.effect(
  'selection transformation forwards exact Unicode/multiline input, preserves prompt and only reports status',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const calls: string[][] = [];
        const { api, pasted } = yield* setup((text, prompt) =>
          Effect.sync(() => {
            calls.push([text, prompt]);
            return 'Hello 👋\nWorld.';
          }),
        );
        const messages: string[] = [];
        assert.strictEqual(
          yield* api.transform('Translate to English.', (message) =>
            Effect.sync(() => {
              messages.push(message);
            }),
          ),
          'Texte remplacé.',
        );
        assert.deepStrictEqual(calls, [[original.text, 'Translate to English.']]);
        assert.deepStrictEqual(pasted, [{ selection: original, text: 'Hello 👋\nWorld.' }]);
        assert.deepStrictEqual(messages, ['Transformation en cours…']);
      }),
    ),
);

it.effect('empty prompts, model failures and empty responses leave the selection untouched', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const first = yield* setup(() => Effect.fail(new IntegrationError({ message: 'Offline' })));
      assert.ok(Result.isFailure(yield* Effect.result(first.api.transform('  '))));
      assert.strictEqual(first.captures(), 0);
      assert.ok(Result.isFailure(yield* Effect.result(first.api.transform('Translate'))));
      assert.deepStrictEqual(first.pasted, []);
      const empty = yield* setup(() => Effect.succeed(' \n'));
      assert.ok(Result.isFailure(yield* Effect.result(empty.api.transform('Correct'))));
      assert.deepStrictEqual(empty.pasted, []);
    }),
  ),
);

it.effect(
  'concurrent presses reject without capturing a second selection and cancellation releases the lock',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const finished = yield* Ref.make(0);
        const { api, captures, pasted } = yield* setup(() =>
          Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(Ref.update(finished, (n) => n + 1)),
          ),
        );
        const fiber = yield* Effect.forkScoped(api.transform('First'));
        yield* Deferred.await(entered);
        const second = yield* Effect.result(api.transform('Second'));
        assert.ok(Result.isFailure(second));
        assert.strictEqual(captures(), 1);
        yield* Fiber.interrupt(fiber);
        assert.strictEqual(yield* Ref.get(finished), 1);
        const third = yield* Effect.forkScoped(api.transform('Third'));
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(third);
        assert.deepStrictEqual(pasted, []);
      }),
    ),
);

it.effect('service scope cancels pending generation and revokes retained APIs', () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const canceled = yield* Ref.make(false);
    const scope = yield* Scope.make();
    const fixture = yield* setup(() =>
      Deferred.succeed(entered, undefined).pipe(
        Effect.andThen(Effect.never),
        Effect.ensuring(Ref.set(canceled, true)),
      ),
    ).pipe(Scope.provide(scope));
    const call = yield* Effect.forkChild(fixture.api.transform('Translate'));
    yield* Deferred.await(entered);
    yield* Scope.close(scope, Exit.void);
    yield* Fiber.await(call);
    assert.strictEqual(yield* Ref.get(canceled), true);
    assert.deepStrictEqual(fixture.pasted, []);
    assert.ok(Result.isFailure(yield* Effect.result(fixture.api.transform('Stale'))));
  }),
);

it.effect(
  'Wayland checks focus and selection both before and after publishing, and never types Enter',
  () =>
    Effect.gen(function* () {
      const current = yield* Ref.make({ ...original });
      let pastes = 0;
      const published: string[] = [];
      let changeOnPublish = false;
      const backend = wayland({
        focused: Ref.get(current).pipe(Effect.map((value) => value.window)),
        primary: Ref.get(current).pipe(Effect.map((value) => value.text)),
        publish: (text) =>
          Effect.sync(() => {
            published.push(text);
          }).pipe(
            Effect.andThen(
              Effect.suspend(() =>
                changeOnPublish
                  ? Ref.update(current, (value) => ({ ...value, window: 11 }))
                  : Effect.void,
              ),
            ),
          ),
        paste: Effect.sync(() => {
          pastes++;
        }),
      });
      const selection = yield* backend.capture;
      yield* backend.replace(selection, 'First\nSecond');
      assert.strictEqual(pastes, 1);
      assert.deepStrictEqual(published, ['First\nSecond']);
      yield* Ref.update(current, (value) => ({ ...value, text: 'Another selection' }));
      assert.ok(Result.isFailure(yield* Effect.result(backend.replace(selection, 'Wrong'))));
      assert.strictEqual(published.length, 1);
      yield* Ref.set(current, original);
      changeOnPublish = true;
      assert.ok(
        Result.isFailure(yield* Effect.result(backend.replace(selection, 'Changed focus'))),
      );
      assert.strictEqual(pastes, 1);
    }),
);

it.effect('Wayland refuses empty selections and focus changes while capturing', () =>
  Effect.gen(function* () {
    let reads = 0;
    const unstable = wayland({
      focused: Effect.sync(() => ++reads),
      primary: Effect.succeed('Selected'),
      publish: () => Effect.void,
      paste: Effect.void,
    });
    assert.ok(Result.isFailure(yield* Effect.result(unstable.capture)));
    const empty = wayland({
      focused: Effect.succeed(1),
      primary: Effect.succeed(''),
      publish: () => Effect.void,
      paste: Effect.void,
    });
    assert.ok(Result.isFailure(yield* Effect.result(empty.capture)));
  }),
);

it.live(
  'Codex adapter uses literal stdin, ephemeral isolated cwd and structured output with scoped files',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'text-model-test-' });
        const executable = `${directory}/fake-codex`;
        yield* fs.writeFileString(
          executable,
          `#!/bin/sh
if [ \"$1\" = 'mcp' ]; then printf '%s' '[{\"name\":\"example.server\",\"transport\":{\"type\":\"stdio\"}}]'; exit 0; fi
printf '%s\\n' "$@" > '${directory}/args'
pwd > '${directory}/cwd'
cat > '${directory}/input'
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--output-last-message' ]; then printf '%s' '{"text":"Hello 👋\\nWorld."}' > "$2"; fi
  shift
done
`,
          { mode: 0o700 },
        );
        const api = yield* codex(executable);
        const text = 'Bonjour $(ne-pas-exécuter)\n👋';
        assert.strictEqual(yield* api.transform({ text, prompt: 'Translate' }), 'Hello 👋\nWorld.');
        assert.deepStrictEqual(JSON.parse(yield* fs.readFileString(`${directory}/input`)), {
          instruction: 'Translate',
          text,
        });
        const args = yield* fs.readFileString(`${directory}/args`);
        assert.include(args, '--ephemeral');
        assert.include(args, '--ignore-user-config');
        assert.include(args, 'read-only');
        assert.include(args, 'shell_tool');
        assert.include(args, '"example.server"={enabled=false,command="false"}');
        assert.strictEqual(args.includes(text), false);
        assert.strictEqual(
          yield* fs.exists((yield* fs.readFileString(`${directory}/cwd`)).trim()),
          false,
        );
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect('TextTransform cancellation belongs to its service as well as its caller', () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const stopped = yield* Ref.make(false);
    const scope = yield* Scope.make();
    const services = yield* Layer.build(
      TextTransform.serviceLayer.pipe(
        Layer.provide(
          Layer.succeed(TextModel, {
            transform: () =>
              Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(Ref.set(stopped, true)),
              ),
          }),
        ),
      ),
    ).pipe(Scope.provide(scope));
    const api = Context.get(services, TextTransform);
    const fiber = yield* Effect.forkChild(api.transform({ text: 'Hello', prompt: 'Translate' }));
    yield* Deferred.await(entered);
    yield* Scope.close(scope, Exit.void);
    yield* Fiber.await(fiber);
    assert.strictEqual(yield* Ref.get(stopped), true);
    assert.ok(
      Result.isFailure(yield* Effect.result(api.transform({ text: 'Hello', prompt: 'Stale' }))),
    );
  }),
);
