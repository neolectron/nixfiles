import { assert, it } from '@effect/vitest';
import { NodeHttpServer, NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Layer, Option, Result, Schema, Stream } from 'effect';
import { HttpClient, HttpClientRequest, HttpServer } from 'effect/http';
import { renderToStaticMarkup } from 'react-dom/server';
import { positionAt } from '@nixfiles/system-control/mpris-clock.ts';
import * as Presentation from '@nixfiles/streamdeck/presentation';
import * as Assets from '../src/presentation-assets.ts';
import { presentation as spotify, type Data } from '../src/plugins/spotify-presentation.tsx';
import { presentation as volume } from '../src/ui/volume-presentation.tsx';
import { LcdView } from '../web/lcd-view.tsx';
import { KeyGrid } from '../web/key-grid.tsx';
import { webSnapshot } from '../src/studio-presentation.ts';
import { Snapshot } from '../src/studio-contract.ts';
import { startStudio, httpApp } from '../src/scripts/studio.ts';
import * as Mock from '../src/mock.ts';
import { demoLayer } from '@nixfiles/system-control/audio.ts';

const track: Data = {
  width: 800,
  height: 100,
  app: { name: 'Spotifast', volume: 43, muted: false, hasAudio: true },
  track: {
    title: 'A <title>',
    artists: ['Artist'],
    status: 'Paused',
    durationMicros: 180_000_000,
    positionMicros: 12_000_000,
    sampledAt: 1000,
    rate: 1,
  },
  cover: '/api/assets/cover-id',
  volumeUntil: 0,
};
it.effect(
  'Spotify publishes portable state and the browser renders actual text, progress and cached artwork',
  () =>
    Effect.gen(function* () {
      const view = yield* spotify.describe(track);
      assert.ok(!JSON.stringify(view).includes('data:image/'));
      const html = renderToStaticMarkup(
        <LcdView
          lcd={{
            index: 0,
            width: 1200,
            height: 100,
            revision: 99,
            scene: [{ x: 200, y: 0, width: 800, height: 100, view }],
          }}
          sessionId="test"
        />,
      );
      assert.include(html, 'A &lt;title&gt;');
      assert.include(html, 'Artist');
      assert.include(html, '0:12');
      assert.include(html, '3:00');
      assert.include(html, '/api/assets/cover-id');
      assert.ok(!html.includes('/api/image/'));
      const render = Presentation.registry([spotify, volume]);
      assert.strictEqual(render({ type: 'unknown.v1', data: {} }), null);
      assert.strictEqual(render({ type: spotify.type, data: { invalid: true } }), null);
      assert.ok(Result.isFailure(yield* Effect.result(spotify.describe({ ...track, width: NaN }))));
    }),
);
it('the shared playback clock advances locally, freezes on pause, supports rate and bounds seeks', () => {
  const sample = { ...track.track, status: 'Playing' as const };
  assert.strictEqual(positionAt(sample, 2000), 13_000_000);
  assert.strictEqual(positionAt({ ...sample, rate: 2 }, 2000), 14_000_000);
  assert.strictEqual(positionAt(track.track, 100_000), 12_000_000);
  assert.strictEqual(positionAt({ ...sample, status: 'Stopped' }, 100_000), 12_000_000);
  assert.strictEqual(positionAt(sample, 0), 12_000_000);
  assert.strictEqual(positionAt(sample, 999_999), 180_000_000);
  assert.strictEqual(positionAt({ ...sample, positionMicros: null }, 2000), null);
});
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6n8AAAAASUVORK5CYII=';
it.live('artwork is deduplicated, bounded and revoked when its scope closes', () =>
  Effect.gen(function* () {
    let url = '';
    const cache = yield* Effect.scoped(
      Effect.gen(function* () {
        const cache = yield* Assets.make;
        url = (yield* cache.publish(png)) ?? '';
        assert.ok(url.startsWith('/api/assets/'));
        assert.strictEqual(yield* cache.publish(png), url);
        assert.deepStrictEqual(
          yield* Effect.all([cache.publish(png), cache.publish(png)], { concurrency: 'unbounded' }),
          [url, url],
        );
        assert.strictEqual(yield* cache.publish('data:image/svg+xml;base64,PHN2Zz4='), undefined);
        assert.strictEqual(
          yield* cache.publish(`data:image/png;base64,${'a'.repeat(2_000_000)}`),
          undefined,
        );
        assert.strictEqual(
          (yield* cache.get(url.split('/').at(-1) ?? ''))?.contentType,
          'image/png',
        );
        for (let i = 1; i <= 8; i++)
          yield* cache.publish(`data:image/png;base64,${btoa(`image-${i}`)}`);
        assert.strictEqual(yield* cache.get(url.split('/').at(-1) ?? ''), undefined);
        return cache;
      }),
    );
    assert.strictEqual(yield* cache.publish(png), undefined);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.live(
  'Studio serves declarative keys and LCD over SSE, ignoring physical frame ticks and caching artwork',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-presentation-' });
        yield* Effect.gen(function* () {
          const app = yield* startStudio({
            profile: `${root}/profile.json`,
            mock: true,
            applications: [],
            configurePlugins: () => Effect.void,
          });
          yield* app.actions.save(0, {
            label: 'React counter',
            action: 'counter',
            parameters: { start: 12 },
          });
          const state = yield* app.snapshot;
          assert.ok(state.lcds[0]?.scene?.length);
          const keyHtml = renderToStaticMarkup(
            <KeyGrid
              snapshot={state}
              selected={null}
              editable={false}
              disabledReason={undefined}
              empty={null}
              onSelect={() => {}}
              onSnapshot={() => {}}
              interactive={false}
              onOrganize={() => Effect.never}
              onNavigate={() => Effect.never}
              onRemove={() => Effect.never}
            />,
          );
          assert.include(keyHtml, 'React counter');
          assert.ok(!keyHtml.includes('/api/image/'));
          const lcdHtml = renderToStaticMarkup(
            <LcdView lcd={state.lcds[0]!} sessionId={state.sessionId} />,
          );
          assert.include(lcdHtml, 'Master');
          assert.ok(!lcdHtml.includes('/api/image/'));
          const physicalOnly = {
            ...state,
            keys: state.keys.map((key) =>
              key.binding ? { ...key, revision: key.revision + 1 } : key,
            ),
            lcds: state.lcds.map((lcd) => ({ ...lcd, revision: lcd.revision + 1 })),
          };
          assert.deepStrictEqual(webSnapshot(physicalOnly), webSnapshot(state));
          assert.notDeepEqual(
            webSnapshot({ ...state, keys: state.keys.map((key) => ({ ...key, pressed: true })) }),
            webSnapshot(state),
          );
          const url = yield* app.assets.publish(png);
          assert.ok(url);
          const server = yield* HttpServer.HttpServer;
          yield* server.serve(yield* httpApp(app, ['http://127.0.0.1:3901']));
          const client = yield* HttpClient.HttpClient;
          const asset = yield* client.get(url!);
          assert.strictEqual(asset.status, 200);
          assert.include(asset.headers['cache-control'] ?? '', 'immutable');
          assert.strictEqual((yield* asset.arrayBuffer).byteLength > 0, true);
          const cached = yield* client.execute(
            HttpClientRequest.get(url!).pipe(
              HttpClientRequest.setHeader('if-none-match', asset.headers.etag ?? ''),
            ),
          );
          assert.strictEqual(cached.status, 304);
          assert.strictEqual((yield* client.get('/api/assets/unknown')).status, 404);
          const events = yield* client.get('/api/events');
          assert.include(events.headers['content-type'] ?? '', 'text/event-stream');
          const data = new TextDecoder().decode(
            Option.getOrThrow(yield* Stream.runHead(events.stream)),
          );
          const line = data.split('\n').find((line) => line.startsWith('data:'));
          assert.ok(line);
          const snapshot = Schema.decodeUnknownSync(Snapshot)(JSON.parse(line!.slice(5).trim()));
          assert.strictEqual(snapshot.lcds[0]?.revision, 0);
          assert.strictEqual(snapshot.keys[0]?.revision, 0);
          assert.ok(snapshot.lcds[0]?.scene?.length);
        }).pipe(
          Effect.provide(Layer.mergeAll(Mock.make().layer(), demoLayer, NodeHttpServer.layerTest)),
        );
      }),
    ).pipe(Effect.provide(NodeServices.layer), Effect.timeout('5 seconds')),
);
