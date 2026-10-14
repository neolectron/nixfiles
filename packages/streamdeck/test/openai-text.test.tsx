import { assert, it } from '@effect/vitest';
import { Effect, Schema } from 'effect';
import { renderToStaticMarkup } from 'react-dom/server';
import * as OpenAI from '../src/plugins/openai-apps.ts';
import * as Text from '../src/plugins/openai-text.ts';
import * as Fields from '../src/plugin-fields.ts';
import * as Host from '../src/plugin-host.ts';
import * as Plugin from '../src/plugin.ts';
import * as Mock from '../src/mock.ts';
import { PluginTiles } from '../web/plugin-tiles.tsx';

it('OpenAI exports three configurable selection tiles with a multiline prompt, without executing them', () => {
  assert.strictEqual(Text.actions.length, 3);
  const html = renderToStaticMarkup(
    <PluginTiles
      busy={false}
      onChoose={() => {
        throw new Error('Rendering executed a tile');
      }}
      actions={Text.actions.map((action) => ({
        ...action.info,
        plugin: OpenAI.plugin.id,
        pluginName: OpenAI.plugin.name,
      }))}
    />,
  );
  for (const action of Text.actions) {
    assert.strictEqual(action.info.tile?.icon, 'openai');
    assert.ok(html.includes(action.info.tile?.label ?? 'missing'));
    assert.strictEqual(Fields.fields(action.info.schema)[0]?.kind, 'multiline');
    assert.ok(Schema.decodeUnknownSync(Text.input)(action.info.defaults).prompt.length > 0);
    const prompt = 'Translate into English.\nKeep line breaks.';
    assert.deepStrictEqual(
      Fields.input(action.info.schema, Fields.draft(action.info.schema, { prompt })),
      { prompt },
    );
  }
});

it.live(
  'OpenAI selection actions use the system service with the edited prompt and stop when disabled',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        let calls = 0;
        let instruction = '';
        const host = yield* Host.make;
        yield* host.install(
          Plugin.define({
            ...OpenAI.plugin,
            setup: Effect.succeed({
              api: {
                prompts: {
                  busy: Effect.succeed(false),
                  run: () => Effect.die('Unexpected prompt job'),
                },
                selection: {
                  transform: (prompt: string) =>
                    Effect.sync(() => {
                      calls++;
                      instruction = prompt;
                      return 'Texte remplacé.';
                    }),
                },
              },
            }),
          }),
        );
        const catalogue = yield* host.catalogue;
        assert.strictEqual(catalogue.filter((action) => action.plugin === 'openai-apps').length, 6);
        assert.strictEqual(calls, 0);
        yield* host.validateAction('openai-apps', 'transform-selection', {
          prompt: 'Custom instruction',
        });
        assert.strictEqual(calls, 0);
        yield* host.setEnabled('openai-apps', true);
        yield* host.invoke('openai-apps', 'transform-selection', { prompt: 'Custom instruction' });
        assert.strictEqual(calls, 1);
        assert.strictEqual(instruction, 'Custom instruction');
        yield* host.setEnabled('openai-apps', false);
        assert.strictEqual(
          (yield* Effect.result(
            host.invoke('openai-apps', 'transform-selection', { prompt: 'Again' }),
          ))._tag,
          'Failure',
        );
        assert.strictEqual(calls, 1);
      }),
    ).pipe(Effect.provide(Mock.make().layer())),
);
