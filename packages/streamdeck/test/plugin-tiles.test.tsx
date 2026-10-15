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

it.live(
  'OBS exports every control as a tile and routes explicit commands without executing during rendering',
  () =>
    Effect.gen(function* () {
      const actions = Obs.plugin.actions!;
      const requests: Array<{ type: string; input: unknown }> = [];
      const api: Obs.Controller = {
        state: Effect.succeed({ connected: true }),
        snapshot: Effect.succeed(Result.succeed({ connected: true })),
        observe: Stream.empty,
        request: (type, input = {}) =>
          Effect.sync(() => {
            requests.push({ type, input });
            return {};
          }),
      };
      const catalogue = Schema.decodeUnknownSync(Catalogue)({
        actions: [],
        applications: [],
        pluginActions: actions.map((action) => ({
          ...action.info,
          plugin: 'obs',
          pluginName: 'OBS Studio',
        })),
      });
      const html = renderToStaticMarkup(
        <PluginTiles
          actions={catalogue.pluginActions}
          busy={false}
          onChoose={() => {
            throw new Error('Palette rendering must not trigger OBS');
          }}
        />,
      );
      assert.strictEqual(catalogue.pluginActions.length, 20);
      for (const action of catalogue.pluginActions) {
        assert.ok(action.tile);
        assert.ok(supports(action, 'key'));
        assert.ok(supports(action, 'lcd'));
        assert.include(html, `aria-label="${action.name}"`);
        assert.include(html, `aria-label="Glisser ${action.name} sur une touche ou le LCD"`);
      }
      assert.deepStrictEqual(requests, []);
      const expected = [
        ['status', 'GetRecordStatus'],
        ['record', 'ToggleRecord'],
        ['start-record', 'StartRecord'],
        ['stop-record', 'StopRecord'],
        ['pause-record', 'PauseRecord'],
        ['resume-record', 'ResumeRecord'],
        ['toggle-record-pause', 'ToggleRecordPause'],
        ['stream', 'ToggleStream'],
        ['start-stream', 'StartStream'],
        ['stop-stream', 'StopStream'],
        ['virtual-camera', 'ToggleVirtualCam'],
        ['start-virtual-camera', 'StartVirtualCam'],
        ['stop-virtual-camera', 'StopVirtualCam'],
        ['start-replay', 'StartReplayBuffer'],
        ['stop-replay', 'StopReplayBuffer'],
        ['toggle-replay', 'ToggleReplayBuffer'],
        ['save-replay', 'SaveReplayBuffer'],
      ] as const;
      for (const [id, type] of expected) {
        const action = actions.find((action) => action.info.id === id)!;
        yield* action.validate({});
        yield* action.feedback!(api, {});
        assert.strictEqual(
          requests.length,
          expected.findIndex((item) => item[0] === id),
        );
        yield* action.execute(api, {}, { output: () => Effect.void });
        assert.deepStrictEqual(requests.at(-1), { type, input: {} });
      }
      yield* actions
        .find((action) => action.info.id === 'scene')!
        .execute(api, { sceneName: 'Camera' }, { output: () => Effect.void });
      yield* actions
        .find((action) => action.info.id === 'mute-input')!
        .execute(api, { inputName: 'Micro' }, { output: () => Effect.void });
      assert.deepStrictEqual(requests.slice(-2), [
        { type: 'SetCurrentProgramScene', input: { sceneName: 'Camera' } },
        { type: 'ToggleInputMute', input: { inputName: 'Micro' } },
      ]);
    }).pipe(Effect.provide(Mock.make().layer())),
);

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
          (action) =>
            action.info.tile &&
            ['launch', 'launch-spotifast', 'chatgpt', 'codex'].includes(action.info.id),
        )
        .map((action) => ({ ...action.info, plugin: plugin.id, pluginName: plugin.name })),
  );
  const catalogue = Schema.decodeUnknownSync(Catalogue)({
    actions: [],
    applications: [],
    pluginActions: actions,
  });
  assert.strictEqual(catalogue.pluginActions.length, 6);
  const html = renderToStaticMarkup(
    <PluginTiles
      actions={catalogue.pluginActions}
      busy={false}
      onChoose={() => {
        throw new Error('Rendering must not execute actions');
      }}
    />,
  );
  for (const name of ['Discord', 'Spotify', 'Spotifast', 'OBS Studio', 'ChatGPT', 'Codex'])
    assert.ok(html.includes(name));
  assert.strictEqual((html.match(/<svg/g) ?? []).length, 12);
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

it.live(
  'the Spotifast tile launches, focuses and tracks only Spotifast, preserving Spotify bindings',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const windows = yield* Ref.make<ReadonlyArray<Window>>([{ id: 1, app_id: 'spotify' }]);
        const launches: string[] = [];
        const focused: number[] = [];
        const makeDesktop = (ids: ReadonlyArray<string>) =>
          Desktop.serviceLayer.pipe(
            Layer.provide(
              Layer.succeed(DesktopBackend, {
                applications: Effect.succeed(
                  ids.map((id) => ({ id, name: id, file: `/fake/${id}` })),
                ),
                windows: Ref.get(windows),
                launch: (app) => Effect.sync(() => void launches.push(app.id)),
                focus: (window) => Effect.sync(() => void focused.push(window.id)),
              }),
            ),
            Layer.build,
            Effect.map((context) => Context.get(context, Desktop)),
          );
        const desktop = yield* makeDesktop(['spotify.desktop', 'spotifast.desktop']);
        const action = AppTiles.launch(AppTiles.spotifast);
        assert.ok(Spotify.plugin.actions!.some((item) => item.info.id === action.info.id));
        assert.ok(Spotify.plugin.actions!.some((item) => item.info.id === 'launch'));
        assert.strictEqual(action.info.tile?.label, 'Spotifast');
        assert.strictEqual(action.info.tile?.icon, 'spotifast');
        assert.strictEqual((yield* action.feedback!({ desktop }, {})).text, 'FERMÉ');
        assert.deepStrictEqual(launches, []);
        yield* action.execute({ desktop }, {}, { output: () => Effect.void });
        assert.deepStrictEqual(launches, ['spotifast.desktop']);
        assert.deepStrictEqual(focused, []);
        yield* Ref.set(windows, [
          { id: 1, app_id: 'spotify' },
          { id: 2, app_id: 'spotifast' },
        ]);
        yield* desktop.refresh;
        assert.strictEqual((yield* action.feedback!({ desktop }, {})).text, 'OUVERT');
        yield* action.execute({ desktop }, {}, { output: () => Effect.void });
        assert.deepStrictEqual(focused, [2]);
        assert.deepStrictEqual(launches, ['spotifast.desktop']);
        yield* Ref.set(windows, [{ id: 1, app_id: 'spotify' }]);
        yield* desktop.refresh;
        assert.strictEqual((yield* action.feedback!({ desktop }, {})).text, 'FERMÉ');
        const spotifyOnly = yield* makeDesktop(['spotify.desktop']);
        assert.strictEqual(
          (yield* action.feedback!({ desktop: spotifyOnly }, {})).text,
          'NON INSTALLÉ',
        );
        assert.ok(
          Result.isFailure(
            yield* Effect.result(
              action.execute({ desktop: spotifyOnly }, {}, { output: () => Effect.void }),
            ),
          ),
        );
        assert.deepStrictEqual(launches, ['spotifast.desktop']);
        assert.deepStrictEqual(focused, [2]);
      }),
    ),
);

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
            yield* host.validateAction('obs', 'start-record', {});
            yield* host.validateAction('obs', 'start-stream', {});
            assert.ok(catalogue.every((action) => action.tile));
            yield* host.setEnabled('obs', true);
            assert.ok((yield* host.snapshot).items.find((item) => item.id === 'obs')?.enabled);
            assert.ok(Result.isFailure(yield* Effect.result(host.invoke('obs', 'record', {}))));
            assert.ok(
              Result.isFailure(yield* Effect.result(host.invoke('obs', 'start-record', {}))),
            );
            assert.strictEqual(
              (yield* host.feedback('obs', 'start-record', {}))?.text,
              'HORS LIGNE',
            );
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
