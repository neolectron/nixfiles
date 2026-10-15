import { assert, it } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import { Effect, Fiber, Layer, Ref, Result, Schedule, Stream } from 'effect';
import { renderToStaticMarkup } from 'react-dom/server';
import { encode } from 'fast-png';
import {
  DesktopBackend,
  make as makeDesktop,
  type Window,
} from '@nixfiles/system-control/desktop.ts';
import * as Mock from '../src/mock.ts';
import { StreamDeck } from '../src/stream-deck.ts';
import * as Surface from '../src/lcd-surface.tsx';
import * as Layout from '../src/lcd-layout.ts';
import * as Image from '../src/image.ts';
import * as Takumi from '../src/takumi.ts';
import * as Assets from '../src/presentation-assets.ts';
import * as Icons from '../src/plugins/system-icons.ts';
import * as Host from '../src/plugin-host.ts';
import * as Plugin from '../src/plugin.ts';
import * as System from '../src/plugins/system.tsx';
import { LcdView } from '../web/lcd-view.tsx';
import { demoLayer, makeLayer as audioLayer } from '@nixfiles/system-control/audio.ts';
import * as Mixer from '../src/plugins/audio-mixer.ts';
import * as Cards from '../src/mixer-cards.ts';
import { LcdSpace } from '../src/lcd-space.ts';
import { startStudio } from '../src/scripts/studio.ts';
import { StateStorage } from '@nixfiles/system-control/state-storage.ts';

const tile: Layout.Tile = {
  id: 'test',
  plugin: 'test',
  action: 'touch',
  input: {},
  label: 'Test',
  width: 200,
  application: '',
};
const config: Layout.Configuration = {
  zones: [
    { id: 'strip', name: 'Strip', lcd: 0, x: 200, width: 200, application: '', pages: [[tile]] },
  ],
  folders: [],
};
it.live(
  'expanded mixer cards respect committed LCD zones and recover space when those zones disappear',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const mock = Mock.make();
        yield* Effect.gen(function* () {
          const surface = yield* Surface.make(yield* StreamDeck, yield* Takumi.make);
          const cards = yield* Cards.make;
          let expanded = true;
          let playerTouches = 0;
          let foregroundTouches = 0;
          yield* cards.register({
            id: 'player',
            matches: (app) => app.key === 'spotifast',
            expandIntoEmpty: true,
            tap: {
              label: 'Player',
              run: () =>
                Effect.sync(() => {
                  playerTouches++;
                }),
            },
            frame: (_, size) =>
              Effect.succeed(
                expanded
                  ? {
                      stamp: `player/${size.width}`,
                      view: { type: 'test.player', data: { width: size.width } },
                      draw: Image.solid(size, [10, 20, 80]),
                    }
                  : undefined,
              ),
          });
          const provider = {
            invoke: () =>
              Effect.sync(() => {
                foregroundTouches++;
              }),
            feedback: () => Effect.succeed(null),
            catalogue: Effect.succeed([]),
            lcdFrame: (
              _plugin: string,
              _action: string,
              _input: unknown,
              size: { width: number; height: number },
            ) =>
              Effect.map(Image.solid(size, [200, 10, 20]).pipe(Effect.orDie), (image) => ({
                image,
                view: { type: 'test.window', data: {} },
              })),
          };
          const configured: Layout.Configuration = {
            ...config,
            zones: [
              {
                ...config.zones[0]!,
                x: 600,
                width: 400,
                application: 'editor',
                pages: [[{ ...tile, width: 400 }]],
              },
            ],
          };
          yield* surface.refresh(configured, provider, 'editor');
          yield* Effect.gen(function* () {
            const mixer = yield* Mixer.make();
            const playerRegion = Effect.map(mixer.regions, (regions) =>
              regions.find((region) => region.dial === 1)!,
            );
            const initial = yield* playerRegion;
            assert.strictEqual(initial.x + initial.width, 600);
            const playerView = (yield* mixer.scene)?.find(
              (region) => region.view.type === 'test.player',
            );
            assert.strictEqual(playerView!.x + playerView!.width, 600);
            const frame = mock.writes.filter((write) => write.kind === 'lcd').at(-1)!;
            if (frame.kind !== 'lcd') throw new Error('Missing composed frame');
            assert.deepStrictEqual(
              [...frame.image.data.slice(650 * 3, 650 * 3 + 3)],
              [200, 10, 20],
            );
            const runner = yield* mixer.run.pipe(Effect.forkScoped);
            yield* mock.emit({ _tag: 'TouchTap', lcd: 0, position: { x: 650, y: 30 } });
            yield* mock.emit({ _tag: 'TouchTap', lcd: 0, position: { x: 500, y: 30 } });
            yield* Effect.repeat(
              Effect.sync(() => foregroundTouches === 1 && playerTouches === 1),
              {
                until: Boolean,
                schedule: Schedule.spaced(1),
              },
            );
            expanded = false;
            yield* mixer.redraw;
            assert.strictEqual((yield* playerRegion).width, 200);
            expanded = true;
            yield* mixer.redraw;
            assert.deepStrictEqual(yield* playerRegion, initial);
            // Conditional zones release and reclaim their space as focus changes.
            yield* surface.refresh(configured, provider, null);
            yield* mixer.redraw;
            assert.strictEqual((yield* playerRegion).x + (yield* playerRegion).width, 1000);
            yield* surface.refresh(configured, provider, 'editor');
            yield* mixer.redraw;
            assert.deepStrictEqual(yield* playerRegion, initial);
            yield* surface.refresh(Layout.empty, provider, null);
            yield* mixer.redraw;
            assert.strictEqual((yield* playerRegion).x + (yield* playerRegion).width, 1000);
            assert.deepStrictEqual((yield* mixer.state).assignments, ['chrome', 'spotifast']);
            yield* Fiber.interrupt(runner);
          }).pipe(
            Effect.provideService(StreamDeck, surface.device),
            Effect.provideService(Cards.MixerCards, cards),
            Effect.provideService(LcdSpace, surface.space),
          );
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              mock.layer(),
              audioLayer({
                list: Effect.succeed(
                  ['chrome', 'spotifast'].map((key) => ({
                    key,
                    name: key,
                    volume: 63,
                    muted: false,
                    mixedMute: false,
                    paused: false,
                    streams: [],
                  })),
                ),
                master: Effect.succeed(undefined),
                change: () => Effect.die('Presentation must not change audio'),
                changeMaster: () => Effect.die('Presentation must not change audio'),
              }),
            ),
          ),
        );
        assert.strictEqual(mock.closes, 1);
      }),
    ).pipe(Effect.provide(NodeServices.layer), Effect.timeout('10 seconds')),
);

it.live(
  'LCD composition preserves the mixer background, routes touch once and restores covered pixels',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const mock = Mock.make();
        yield* Effect.gen(function* () {
          const deck = yield* StreamDeck;
          const renderer = yield* Takumi.make;
          const surface = yield* Surface.make(deck, renderer);
          const invoked: string[] = [];
          const provider = {
            invoke: (plugin: string, action: string) =>
              Effect.sync(() => {
                invoked.push(`${plugin}/${action}`);
              }),
            feedback: () => Effect.succeed(null),
            catalogue: Effect.succeed([]),
            lcdFrame: (
              _plugin: string,
              _action: string,
              _input: unknown,
              size: { width: number; height: number },
            ) =>
              Effect.map(Image.solid(size, [200, 10, 20]).pipe(Effect.orDie), (image) => ({
                image,
                view: { type: 'test.v1', data: {} },
              })),
          };
          const background = yield* Image.solid({ width: 1200, height: 100 }, [10, 20, 80]);
          yield* surface.device.lcd(0).setImage(background);
          yield* surface.refresh(config, provider, null);
          yield* surface.device
            .lcd(0)
            .drawRegion({ x: 0, y: 0 }, yield* Image.solid({ width: 600, height: 100 }, [1, 2, 3]));
          const frame = mock.writes.at(-1)!;
          if (frame.kind !== 'region') throw new Error('Expected a partial composed frame');
          assert.strictEqual(frame.image.width, 600);
          assert.deepStrictEqual(frame.position, { x: 0, y: 0 });
          assert.deepStrictEqual([...frame.image.data.slice(200 * 3, 200 * 3 + 3)], [200, 10, 20]);
          assert.deepStrictEqual([...frame.image.data.slice(100 * 3, 100 * 3 + 3)], [1, 2, 3]);
          yield* surface.device
            .lcd(0)
            .drawRegion(
              { x: 100, y: 0 },
              yield* Image.solid({ width: 200, height: 100 }, [1, 2, 3]),
            );
          const knobFrame = mock.writes.at(-1)!;
          if (knobFrame.kind !== 'region') throw new Error('Expected a knob-sized USB frame');
          assert.strictEqual(knobFrame.image.width, 200);
          assert.deepStrictEqual(knobFrame.position, { x: 100, y: 0 });
          assert.deepStrictEqual([...knobFrame.image.data.slice(0, 3)], [1, 2, 3]);
          assert.deepStrictEqual(
            [...knobFrame.image.data.slice(100 * 3, 100 * 3 + 3)],
            [200, 10, 20],
          );
          const subscription = yield* surface.device.subscribe;
          const received: string[] = [];
          const reader = yield* Effect.forkScoped(
            Stream.runForEach(subscription, (event) =>
              Effect.sync(() => received.push(event._tag)),
            ),
          );
          yield* mock.emit({ _tag: 'TouchTap', lcd: 0, position: { x: 250, y: 20 } });
          yield* mock.emit({ _tag: 'TouchTap', lcd: 0, position: { x: 900, y: 20 } });
          yield* Effect.repeat(
            Effect.sync(() => invoked.length === 1 && received.length === 1),
            { until: Boolean, schedule: Schedule.spaced(1) },
          );
          assert.deepStrictEqual(invoked, ['test/touch']);
          assert.deepStrictEqual(received, ['TouchTap']);
          yield* Fiber.interrupt(reader);
          yield* surface.refresh(Layout.empty, provider, null);
          const restored = mock.writes.filter((write) => write.kind === 'lcd').at(-1)!;
          if (restored.kind !== 'lcd') throw new Error('Missing restored frame');
          assert.deepStrictEqual([...restored.image.data.slice(200 * 3, 200 * 3 + 3)], [1, 2, 3]);
          const paged = {
            ...config,
            zones: [
              { ...config.zones[0]!, pages: [[tile], [{ ...tile, id: 'other', action: 'other' }]] },
            ],
          };
          yield* surface.refresh(paged, provider, null);
          yield* surface.navigate({ zone: 'strip', operation: 'next' });
          // A requested page does not change hit testing before its frame is committed.
          assert.deepStrictEqual((yield* surface.snapshot).navigation, {});
          yield* surface.input(0, 'tap', 250, 20);
          yield* Effect.repeat(
            Effect.sync(() => invoked.length),
            { until: (count) => count === 2, schedule: Schedule.spaced(1) },
          );
          assert.strictEqual(invoked.at(-1), 'test/touch');
          yield* surface.refresh(paged, provider, null);
          yield* surface.input(0, 'tap', 250, 20);
          yield* Effect.repeat(
            Effect.sync(() => invoked.length),
            { until: (count) => count === 3, schedule: Schedule.spaced(1) },
          );
          assert.strictEqual(invoked.at(-1), 'test/other');
        }).pipe(Effect.provide(mock.layer()));
        assert.strictEqual(mock.closes, 1);
      }),
    ).pipe(Effect.provide(NodeServices.layer), Effect.timeout('10 seconds')),
);

it.live('LCD plugin frames and in-flight actions are revoked with the plugin scope', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const mock = Mock.make();
      yield* Effect.gen(function* () {
        const host = yield* Host.make;
        let rendering = false;
        let released = false;
        const plugin = Plugin.define({
          id: 'lcd-test',
          name: 'LCD test',
          description: '',
          controls: {},
          setup: Effect.succeed({ api: {} }),
          actions: [
            Plugin.action({
              id: 'wait',
              name: 'Wait',
              description: '',
              input: Plugin.NoInput,
              defaults: {},
              tile: { label: 'Wait', icon: 'plugin', surfaces: ['lcd'] },
              run: () => Effect.never,
              lcd: () =>
                Effect.acquireUseRelease(
                  Effect.sync(() => {
                    rendering = true;
                  }),
                  () => Effect.never,
                  () =>
                    Effect.sync(() => {
                      released = true;
                    }),
                ),
            }),
          ],
        });
        yield* host.install(plugin);
        yield* host.setEnabled('lcd-test', true);
        assert.ok(
          Result.isFailure(
            yield* Effect.result(host.validateAction('lcd-test', 'wait', {}, 'key')),
          ),
        );
        const frame = yield* Effect.forkScoped(
          host.lcdFrame('lcd-test', 'wait', {}, { width: 200, height: 100 }),
        );
        yield* Effect.repeat(
          Effect.sync(() => rendering),
          { until: Boolean, schedule: Schedule.spaced(1) },
        );
        yield* host.setEnabled('lcd-test', false);
        yield* Fiber.await(frame);
        assert.ok(released);
        assert.ok(
          Result.isFailure(
            yield* Effect.result(
              host.lcdFrame('lcd-test', 'wait', {}, { width: 200, height: 100 }),
            ),
          ),
        );
      }).pipe(Effect.provide(mock.layer()));
    }),
  ).pipe(Effect.provide(NodeServices.layer), Effect.timeout('10 seconds')),
);

it.live(
  'the System LCD tile follows focus/title and publishes a cached icon URL for browser React',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const windows = yield* Ref.make<ReadonlyArray<Window>>([
          { id: 1, app_id: 'editor', title: 'My <document>', is_focused: true },
        ]);
        const desktop = yield* makeDesktop.pipe(
          Effect.provideService(DesktopBackend, {
            applications: Effect.succeed([
              {
                id: 'editor.desktop',
                name: 'Editor',
                file: '/fake/editor.desktop',
                icon: 'editor',
              },
            ]),
            windows: Ref.get(windows),
            launch: () => Effect.die('Display must never launch an app'),
            focus: () => Effect.die('Display must never focus a window'),
          }),
        );
        const assets = yield* Assets.make;
        const renderer = yield* Takumi.make;
        const mock = Mock.make();
        yield* Effect.gen(function* () {
          const surface = yield* Surface.make(yield* StreamDeck, renderer);
          const bytes = encode({
            width: 1,
            height: 1,
            channels: 3,
            depth: 8,
            data: new Uint8Array([0, 200, 0]),
          });
          const api = {
            desktop,
            surface,
            renderer,
            assets,
            icon: yield* Icons.make({
              resolve: () => Effect.succeed({ bytes, contentType: 'image/png' }),
            }),
          };
          const first = yield* System.activeWindow.lcd!(api, {}, { width: 400, height: 100 });
          const image = yield* first.draw;
          assert.strictEqual(image.width, 400);
          assert.strictEqual(image.height, 100);
          assert.ok(first.view);
          const html = renderToStaticMarkup(
            <LcdView
              lcd={{
                index: 0,
                width: 1200,
                height: 100,
                revision: 1,
                scene: [{ x: 0, y: 0, width: 400, height: 100, view: first.view! }],
              }}
              sessionId="test"
            />,
          );
          assert.include(html, 'My &lt;document&gt;');
          assert.include(html, 'Editor');
          assert.include(html, '/api/assets/');
          assert.notInclude(JSON.stringify(first.view), 'data:image/');
          assert.notInclude(html, '/api/image/');
          const second = yield* System.activeWindow.lcd!(api, {}, { width: 400, height: 100 });
          assert.deepStrictEqual(second.view, first.view);
          yield* Ref.set(windows, [
            { id: 2, app_id: 'terminal', title: 'Shell', is_focused: true },
          ]);
          yield* desktop.refresh;
          const next = yield* System.activeWindow.lcd!(api, {}, { width: 400, height: 100 });
          assert.include(JSON.stringify(next.view), 'Shell');
          yield* Ref.set(windows, []);
          yield* desktop.refresh;
          assert.include(
            JSON.stringify(
              (yield* System.activeWindow.lcd!(api, {}, { width: 400, height: 100 })).view,
            ),
            '"application":""',
          );
        }).pipe(Effect.provide(mock.layer()));
      }),
    ).pipe(Effect.provide(NodeServices.layer), Effect.timeout('10 seconds')),
);

it.live('LCD configuration validates before persistence and shares the atomic profile save', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const mock = Mock.make();
      yield* Effect.gen(function* () {
        let runs = 0;
        const studio = yield* startStudio({
          profile: '/memory/profile.json',
          mock: true,
          applications: [],
          persistence: StateStorage.layerMemory,
          configurePlugins: (host) =>
            host.install(
              Plugin.define({
                id: 'test',
                name: 'Test',
                description: '',
                controls: {},
                setup: Effect.succeed({ api: {} }),
                actions: [
                  Plugin.action({
                    id: 'touch',
                    name: 'Touch',
                    description: '',
                    input: Plugin.NoInput,
                    defaults: {},
                    tile: { label: 'Touch', icon: 'plugin' },
                    run: () =>
                      Effect.sync(() => {
                        runs++;
                      }),
                  }),
                ],
              }),
            ),
        });
        const before = yield* studio.snapshot;
        const invalid = {
          ...before.configuration.profile,
          lcd: { ...config, zones: [{ ...config.zones[0]!, width: 2000 }] },
        };
        assert.ok(
          Result.isFailure(
            yield* Effect.result(
              studio.actions.saveProfile(
                invalid,
                before.configuration.navigation,
                before.configuration.revision,
                before.configuration.profile,
              ),
            ),
          ),
        );
        assert.deepStrictEqual((yield* studio.snapshot).configuration, before.configuration);
        const next = { ...before.configuration.profile, lcd: config };
        yield* studio.actions.saveProfile(
          next,
          before.configuration.navigation,
          before.configuration.revision,
          before.configuration.profile,
        );
        assert.deepStrictEqual((yield* studio.snapshot).configuration.profile.lcd, config);
        assert.strictEqual(runs, 0);
        yield* studio.setPlugin({ id: 'test', enabled: true, expected: false });
        const ready = yield* studio.snapshot;
        const input = {
          lcd: 0,
          kind: 'tap' as const,
          x: 250,
          y: 50,
          revision: ready.lcdLayout!.revision,
          sessionId: ready.sessionId,
        };
        assert.ok(
          Result.isFailure(yield* Effect.result(studio.lcdInput({ ...input, sessionId: 'stale' }))),
        );
        assert.ok(
          Result.isFailure(yield* Effect.result(studio.lcdInput({ ...input, revision: -1 }))),
        );
        assert.strictEqual(runs, 0);
        yield* studio.lcdInput(input);
        yield* Effect.repeat(
          Effect.sync(() => runs),
          { until: (count) => count === 1, schedule: Schedule.spaced(1) },
        );
        assert.ok(
          Result.isFailure(
            yield* Effect.result(
              studio.actions.saveProfile(
                before.configuration.profile,
                {},
                before.configuration.revision,
                before.configuration.profile,
              ),
            ),
          ),
        );
      }).pipe(Effect.provide(Layer.mergeAll(mock.layer(), demoLayer)));
    }),
  ).pipe(Effect.provide(NodeServices.layer), Effect.timeout('10 seconds')),
);
