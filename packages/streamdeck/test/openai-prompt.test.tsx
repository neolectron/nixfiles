import { assert, it } from '@effect/vitest';
import { Deferred, Effect, Fiber, Ref, Result } from 'effect';
import { renderToStaticMarkup } from 'react-dom/server';
import * as OpenAI from '../src/plugins/openai-apps.ts';
import * as Prompt from '../src/plugins/openai-prompt.ts';
import * as Fields from '../src/plugin-fields.ts';
import * as Host from '../src/plugin-host.ts';
import * as Plugin from '../src/plugin.ts';
import * as Mock from '../src/mock.ts';
import { PluginTiles } from '../web/plugin-tiles.tsx';
import * as Dot from '@nixfiles/system-control/dot-call.ts';

it('OpenAI exports a ready-to-place prompt tile with multiline instructions and explicit project access', () => {
  assert.ok(OpenAI.plugin.actions!.includes(Prompt.action));
  const action = Prompt.action.info;
  const fields = Fields.fields(action.schema);
  assert.strictEqual(fields.find((field) => field.key === 'prompt')?.kind, 'multiline');
  assert.strictEqual(action.defaults.access, 'read-only');
  assert.deepStrictEqual(
    Fields.input(action.schema, Fields.draft(action.schema, action.defaults)),
    action.defaults,
  );
  const html = renderToStaticMarkup(
    <PluginTiles
      busy={false}
      actions={[{ ...action, plugin: OpenAI.plugin.id, pluginName: OpenAI.plugin.name }]}
      onChoose={() => {
        throw new Error('Rendering executed a prompt');
      }}
    />,
  );
  assert.include(html, 'Prompt Codex');
});

it.live(
  'prompt actions forward saved configuration and output, and disabling cancels the active job',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const host = yield* Host.make;
        const dot = yield* Dot.make.pipe(
          Effect.provideService(Dot.DotCallBackend, {
            read: Effect.succeed(Dot.idle),
            call: Effect.die('Unexpected call'),
            hangup: () => Effect.die('Unexpected hangup'),
          }),
        );
        let seen: unknown;
        const entered = yield* Deferred.make<void>();
        const stopped = yield* Ref.make(false);
        yield* host.install(
          Plugin.define({
            ...OpenAI.plugin,
            setup: Effect.succeed({
              api: {
                dot,
                voice: {
                  ready: Effect.void,
                  hold: () => Effect.die('Unexpected microphone access'),
                },
                selection: { transform: () => Effect.die('Unexpected selection access') },
                prompts: {
                  busy: Effect.succeed(false),
                  run: (input: unknown) =>
                    Effect.sync(() => {
                      seen = input;
                    }).pipe(
                      Effect.andThen(Deferred.succeed(entered, undefined)),
                      Effect.andThen(Effect.never),
                      Effect.ensuring(Ref.set(stopped, true)),
                    ),
                },
              },
            }),
          }),
        );
        const input = {
          prompt: 'My exact prompt\nwith two lines',
          directory: '/tmp/project',
          access: 'read-only',
        };
        yield* host.validateAction('openai-apps', 'run-prompt', input);
        assert.strictEqual(seen, undefined);
        yield* host.setEnabled('openai-apps', true);
        const output: string[] = [];
        const job = yield* Effect.forkScoped(
          host.invoke('openai-apps', 'run-prompt', input, {
            output: (text) =>
              Effect.sync(() => {
                output.push(text);
              }),
          }),
        );
        yield* Deferred.await(entered);
        assert.deepStrictEqual(seen, input);
        assert.deepStrictEqual(output, ['Codex en cours…\n']);
        yield* host.setEnabled('openai-apps', false);
        yield* Fiber.await(job);
        assert.strictEqual(yield* Ref.get(stopped), true);
        assert.ok(
          Result.isFailure(yield* Effect.result(host.invoke('openai-apps', 'run-prompt', input))),
        );
      }),
    ).pipe(Effect.provide(Mock.make().layer())),
);
