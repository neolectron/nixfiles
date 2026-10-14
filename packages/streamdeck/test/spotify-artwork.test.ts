import { assert, it } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import { Deferred, Effect, FileSystem, Layer, Ref, Scope } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { Base64 } from 'effect/encoding';
import { encode } from 'fast-png';
import * as Artwork from '../src/plugins/spotify-artwork.ts';

const png = encode({ width: 1, height: 1, channels: 4, data: new Uint8Array([255, 0, 0, 255]) });

it.effect('cover requests are non-blocking, deduplicated and bounded to two concurrent loads', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const pending = yield* Deferred.make<string>();
      const started = yield* Ref.make<string[]>([]);
      const covers = yield* Artwork.make((url) =>
        Ref.update(started, (urls) => [...urls, url]).pipe(Effect.andThen(Deferred.await(pending))),
      );
      assert.strictEqual(yield* covers.current('a'), undefined);
      yield* covers.current('a');
      yield* covers.current('b');
      yield* covers.current('c');
      yield* Effect.yieldNow;
      assert.deepStrictEqual(yield* Ref.get(started), ['a', 'b']);
      yield* Deferred.succeed(pending, 'data:image/png;base64,cover');
      yield* Effect.yieldNow;
      assert.strictEqual(yield* covers.current('a'), 'data:image/png;base64,cover');
      yield* covers.current('c');
      yield* Effect.yieldNow;
      assert.deepStrictEqual(yield* Ref.get(started), ['a', 'b', 'c']);
    }),
  ),
);

it.effect('failed covers stay absent and the bounded cache evicts old completed entries', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const requests: string[] = [];
      const covers = yield* Artwork.make((url) =>
        Effect.sync(() => {
          requests.push(url);
        }).pipe(Effect.andThen(url === 'bad' ? Effect.fail('offline') : Effect.succeed(url))),
      );
      yield* covers.current('bad');
      yield* Effect.yieldNow;
      yield* covers.current('bad');
      assert.deepStrictEqual(requests, ['bad']);
      for (let i = 0; i < 9; i++) {
        yield* covers.current(String(i));
        yield* Effect.yieldNow;
      }
      yield* covers.current('0');
      yield* Effect.yieldNow;
      assert.strictEqual(requests.filter((url) => url === '0').length, 2);
    }),
  ),
);

it.effect('closing the plugin scope cancels pending cover loads', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const owner = yield* Scope.make();
      const started = yield* Deferred.make<void>();
      const stopped = yield* Ref.make(false);
      const covers = yield* Artwork.make(() =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(Ref.set(stopped, true)),
        ),
      ).pipe(Scope.provide(owner));
      yield* covers.current('pending');
      yield* Deferred.await(started);
      yield* Scope.close(owner, yield* Effect.exit(Effect.void));
      assert.strictEqual(yield* Ref.get(stopped), true);
      assert.strictEqual(yield* covers.current('pending'), undefined);
    }),
  ),
);

it.live(
  'artwork boundary supports local PNGs, rejects invalid schemes and bounds HTTP bodies',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'spotify-artwork-' });
        yield* fs.writeFile(`${directory}/cover.png`, png);
        assert.strictEqual(
          yield* Artwork.load(`file://${directory}/cover.png`),
          `data:image/png;base64,${Base64.encode(png)}`,
        );
        assert.strictEqual(
          (yield* Effect.result(Artwork.load('ftp://example.invalid/cover')))._tag,
          'Failure',
        );
        let requests = 0;
        const transport = Layer.mergeAll(
          FetchHttpClient.layer,
          Layer.succeed(FetchHttpClient.Fetch, async () => {
            requests++;
            return new Response(new Uint8Array(1024 * 1024 + 1));
          }),
        );
        const result = yield* Effect.result(
          Artwork.load('https://example.invalid/cover').pipe(Effect.provide(transport)),
        );
        assert.strictEqual(result._tag, 'Failure');
        assert.strictEqual(requests, 1);
        if (result._tag === 'Failure') assert.strictEqual(result.failure._tag, 'IntegrationError');
      }),
    ).pipe(Effect.provide(NodeServices.layer), Effect.provide(FetchHttpClient.layer)),
);
