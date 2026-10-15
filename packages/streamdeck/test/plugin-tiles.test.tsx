import { assert, it } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import { Context, Effect, Layer, Ref, Result, Schema, Stream } from 'effect';
import { renderToStaticMarkup } from 'react-dom/server';
import { Desktop, DesktopBackend, type Window } from '@nixfiles/system-control/desktop.ts';
import { IntegrationError } from '@nixfiles/system-control/errors.ts';
import { Obs as SystemObs } from '@nixfiles/system-control/obs.ts';
import * as Plugin from '../src/plugin.ts';
import * as Host from '../src/plugin-host.ts';
import * as Mock from '../src/mock.ts';
import * as Obs from '../src/plugins/obs.ts';
import * as AppTiles from '../src/plugins/application-tiles.ts';
import * as OpenAIApps from '../src/plugins/openai-apps.ts';
import * as Discord from '../src/plugins/discord.ts';
import * as Spotify from '../src/plugins/spotify.ts';
import * as Media from '../src/plugins/media.ts';
import { Catalogue } from '../src/studio-contract.ts';
import { PluginTiles } from '../web/plugin-tiles.tsx';
import { KeyCard } from '../src/ui/key-card.tsx';
import { supports } from '../src/tile-capabilities.ts';

it('every standard media command exports an assignable tile with its icon and drag handle', () => {
  const actions = Media.plugin.actions!.map((action) => ({
    ...action.info,
    plugin: Media.plugin.id,
    pluginName: Media.plugin.name,
  }));
  const catalogue = Schema.decodeUnknownSync(Catalogue)({
    actions: [],
    applications: [],
    pluginActions: actions,
  });
  assert.deepStrictEqual(
    catalogue.pluginActions.map((action) => [action.id, action.tile?.icon]),
    [
      ['previous', 'previous'],
      ['play-pause', 'play'],
      ['next', 'next'],
      ['play', 'play'],
      ['pause', 'pause'],
      ['stop', 'stop'],
    ],
  );
  const html = renderToStaticMarkup(
    <PluginTiles
      actions={catalogue.pluginActions}
      busy={false}
      onChoose={() => {
        throw new Error('Rendering must not execute or assign media actions');
      }}
    />,
  );
  for (const action of catalogue.pluginActions) {
    assert.deepStrictEqual(Schema.decodeUnknownSync(Plugin.NoInput)(action.defaults), {});
    assert.ok(supports(action, 'key'));
    assert.ok(supports(action, 'lcd'));
    assert.include(html, `aria-label="${action.name}"`);
    assert.include(html, `aria-label="Glisser ${action.name} sur une touche ou le LCD"`);
  }
  assert.notInclude(html, 'Aucune tile exportée');
});

it.live('a plugin can export a tile with no custom renderer or feedback callback', () =>
  Effect.gen(function* () {
    const action = Plugin.action({
      id: 'hello',
      name: 'Hello',
      description: '',
      input: Plugin.NoInput,
      defaults: {},
      tile: { label: 'Hello', icon: 'play' },
      run: () => Effect.void,
    });
    assert.deepStrictEqual(yield* action.feedback!({}, {}), {
      icon: 'play',
      text: 'PRÊT',
      tone: 'neutral',
    });
    assert.deepStrictEqual(action.unavailable, {
      icon: 'play',
      text: 'DÉSACTIVÉ',
      tone: 'neutral',
    });
  }),
);

it('launch tiles are exported by their plugin with strict defaults and reusable branded rendering', () => {
  const actions = [Discord.plugin, Spotify.plugin, Obs.plugin, OpenAIApps.plugin].flatMap(
    (plugin) =>
      plugin
        .actions!.filter(
          (action) => action.info.tile && ['launch', 'chatgpt', 'codex'].includes(action.info.id),
        )
        .map((action) => ({ ...action.info, plugin: plugin.id, pluginName: plugin.name })),
  );
  const catalogue = Schema.decodeUnknownSync(Catalogue)({
    actions: [],
    applications: [],
    pluginActions: actions,
  });
  assert.strictEqual(catalogue.pluginActions.length, 5);
  const html = renderToStaticMarkup(
    <PluginTiles
      actions={catalogue.pluginActions}
      busy={false}
      onChoose={() => {
        throw new Error('Rendering must not execute actions');
      }}
    />,
  );
  for (const name of ['Discord', 'Spotify', 'OBS Studio', 'ChatGPT', 'Codex'])
    assert.ok(html.includes(name));
  assert.strictEqual((html.match(/<svg/g) ?? []).length, 10);
  for (const action of catalogue.pluginActions) {
    assert.deepStrictEqual(Schema.decodeUnknownSync(Plugin.NoInput)(action.defaults), {});
    const face = renderToStaticMarkup(
      <KeyCard
        width={100}
        height={100}
        label={action.tile!.label}
        action="plugin"
        count={0}
        status="idle"
        feedback={{ icon: action.tile!.icon, tone: 'positive', text: 'OUVERT' }}
      />,
    );
    assert.ok(face.includes('OUVERT'));
    assert.ok(face.includes('<svg'));
  }
});

it('palette tiles remain draggable without a selected deck key, and lock while busy', () => {
  const actions = Obs.plugin
    .actions!.filter((action) => action.info.tile)
    .map((action) => ({ ...action.info, plugin: Obs.plugin.id, pluginName: Obs.plugin.name }));
  const render = (busy: boolean) =>
    renderToStaticMarkup(
      <PluginTiles
        actions={actions}
        busy={busy}
        canChoose={false}
        onChoose={() => {
          throw new Error('Rendering must not assign or execute actions');
        }}
      />,
    );
  assert.notInclude(render(false), 'disabled');
  assert.strictEqual((render(true).match(/disabled=""/g) ?? []).length, actions.length * 2);
});

it.live(
  'offline OBS enables, configures launch tiles, reports action errors and stays enabled',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const windows = yield* Ref.make<ReadonlyArray<Window>>([]);
        const launches: string[] = [];
        const desktopLayer = Desktop.serviceLayer.pipe(
          Layer.provide(
            Layer.succeed(DesktopBackend, {
              applications: Effect.succeed([
                {
                  id: 'com.obsproject.Studio.desktop',
                  name: 'OBS Studio',
                  file: '/fake/obs.desktop',
                },
              ]),
              windows: Ref.get(windows),
              launch: (app) =>
                Effect.sync(() => {
                  launches.push(app.id);
                }),
              focus: () => Effect.void,
            }),
          ),
        );
        const offline = new IntegrationError({ message: 'OBS WebSocket hors ligne.' });
        const obsLayer = Layer.succeed(SystemObs, {
          state: Effect.fail(offline),
          snapshot: Effect.succeed(Result.fail(offline)),
          observe: Stream.empty,
          request: () => Effect.fail(offline),
        });
        yield* Effect.scoped(
          Effect.gen(function* () {
            const host = yield* Host.make;
            yield* host.install(Obs.plugin);
            const catalogue = yield* host.catalogue;
            assert.strictEqual(
              catalogue.find((action) => action.id === 'launch')?.tile?.icon,
              'obs',
            );
            yield* host.validateAction('obs', 'launch', {});
            yield* host.setEnabled('obs', true);
            assert.ok((yield* host.snapshot).items.find((item) => item.id === 'obs')?.enabled);
            assert.ok(Result.isFailure(yield* Effect.result(host.invoke('obs', 'record', {}))));
            assert.ok((yield* host.snapshot).items.find((item) => item.id === 'obs')?.enabled);
            assert.strictEqual((yield* host.feedback('obs', 'launch', {}))?.text, 'FERMÉ');
            yield* host.invoke('obs', 'launch', {});
            assert.deepStrictEqual(launches, ['com.obsproject.Studio.desktop']);
            yield* Ref.set(windows, [{ id: 1, app_id: 'obs' }]);
            yield* (yield* Desktop).refresh;
            assert.strictEqual((yield* host.feedback('obs', 'launch', {}))?.text, 'OUVERT');
            yield* host.setEnabled('obs', false);
            assert.strictEqual((yield* host.feedback('obs', 'launch', {}))?.text, 'DÉSACTIVÉ');
          }).pipe(Effect.provide(Layer.mergeAll(Mock.make().layer(), desktopLayer, obsLayer))),
        );
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.live(
  'launch action feedback is independent of audio/RPC and never launches while rendering',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        let launches = 0;
        const api = yield* Desktop.serviceLayer
          .pipe(
            Layer.provide(
              Layer.succeed(DesktopBackend, {
                applications: Effect.succeed([
                  { id: 'discord.desktop', name: 'Discord', file: '/fake/discord.desktop' },
                ]),
                windows: Effect.succeed([]),
                launch: () =>
                  Effect.sync(() => {
                    launches++;
                  }),
                focus: () => Effect.void,
              }),
            ),
          )
          .pipe(Layer.build);
        const desktop = Context.get(api, Desktop);
        const action = AppTiles.launch(AppTiles.discord);
        assert.strictEqual((yield* action.feedback!({ desktop }, {})).text, 'FERMÉ');
        assert.strictEqual(launches, 0);
        yield* action.execute({ desktop }, {}, { output: () => Effect.void });
        assert.strictEqual(launches, 1);
      }),
    ),
);
