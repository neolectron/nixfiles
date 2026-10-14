import { assert, it } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import { Effect, Ref, Result, Schema } from 'effect';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AppearanceBackend,
  SystemAppearance,
  make,
  decodePreference,
} from '@nixfiles/system-control/appearance.ts';
import { IntegrationError } from '@nixfiles/system-control/errors.ts';
import * as Appearance from '../src/plugins/appearance.ts';
import * as Host from '../src/plugin-host.ts';
import * as Plugin from '../src/plugin.ts';
import * as Mock from '../src/mock.ts';
import { PluginTiles } from '../web/plugin-tiles.tsx';

it('appearance exports three ready-to-place tiles with no settings or execution during rendering', () => {
  const actions = Appearance.plugin.actions!;
  assert.deepStrictEqual(
    actions.map((action) => action.info.id),
    ['toggle', 'dark', 'light'],
  );
  const html = renderToStaticMarkup(
    <PluginTiles
      busy={false}
      onChoose={() => {
        throw new Error('Rendering executed a tile');
      }}
      actions={actions.map((action) => ({
        ...action.info,
        plugin: Appearance.plugin.id,
        pluginName: Appearance.plugin.name,
      }))}
    />,
  );
  for (const action of actions) {
    assert.deepStrictEqual(Schema.decodeUnknownSync(Plugin.NoInput)(action.info.defaults), {});
    assert.ok(html.includes(action.info.tile!.label));
  }
});

it.live(
  'appearance plugin maps actions to the shared system service and mirrors actual theme changes',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const current = yield* Ref.make(decodePreference('prefer-light'));
        const writes: string[] = [];
        const api = yield* make.pipe(
          Effect.provideService(AppearanceBackend, {
            read: Ref.get(current),
            set: (mode) =>
              Effect.sync(() => writes.push(mode)).pipe(
                Effect.andThen(Ref.set(current, decodePreference(`prefer-${mode}`))),
              ),
          }),
        );
        yield* Effect.gen(function* () {
          const host = yield* Host.make;
          yield* host.install(Appearance.plugin);
          assert.strictEqual((yield* host.catalogue).length, 3);
          yield* host.validateAction('appearance', 'toggle', {});
          yield* host.setEnabled('appearance', true);
          assert.deepStrictEqual(writes, []);
          assert.strictEqual((yield* host.feedback('appearance', 'toggle', {}))?.icon, 'sun');
          yield* host.invoke('appearance', 'toggle', {});
          assert.deepStrictEqual(writes, ['dark']);
          assert.strictEqual((yield* host.feedback('appearance', 'toggle', {}))?.text, 'SOMBRE');
          assert.strictEqual((yield* host.feedback('appearance', 'dark', {}))?.tone, 'positive');
          yield* host.invoke('appearance', 'light', {});
          yield* host.invoke('appearance', 'dark', {});
          assert.deepStrictEqual(writes, ['dark', 'light', 'dark']);
          yield* Ref.set(current, decodePreference('prefer-light'));
          yield* api.refresh;
          assert.strictEqual((yield* host.feedback('appearance', 'toggle', {}))?.text, 'CLAIR');
          yield* host.setEnabled('appearance', false);
          assert.ok(
            Result.isFailure(yield* Effect.result(host.invoke('appearance', 'toggle', {}))),
          );
          assert.deepStrictEqual(writes, ['dark', 'light', 'dark']);
        }).pipe(Effect.provideService(SystemAppearance, api));
      }),
    ).pipe(Effect.provide(Mock.make().layer()), Effect.provide(NodeServices.layer)),
);

it.live('appearance remains configurable when the system preference is unavailable', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const offline = new IntegrationError({ message: 'No desktop session' });
      const api = yield* make.pipe(
        Effect.provideService(AppearanceBackend, {
          read: Effect.fail(offline),
          set: () => Effect.fail(offline),
        }),
      );
      yield* Effect.gen(function* () {
        const host = yield* Host.make;
        yield* host.install(Appearance.plugin);
        yield* host.setEnabled('appearance', true);
        assert.strictEqual(
          (yield* host.feedback('appearance', 'toggle', {}))?.text,
          'INDISPONIBLE',
        );
        assert.ok(Result.isFailure(yield* Effect.result(host.invoke('appearance', 'toggle', {}))));
        assert.strictEqual((yield* host.snapshot).items[0]!.enabled, true);
      }).pipe(Effect.provideService(SystemAppearance, api));
    }),
  ).pipe(Effect.provide(Mock.make().layer()), Effect.provide(NodeServices.layer)),
);
