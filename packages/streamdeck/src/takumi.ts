import { NodeFileSystem, NodePath } from '@effect/platform-node';
import { Effect, FileSystem, Layer, Path, Semaphore } from 'effect';
import { renderToStaticMarkup } from 'react-dom/server';
import { fromHtml } from '@takumi-rs/helpers/html';
import type { ReactElement } from 'react';
import type { RgbImage } from './image.ts';
import type { Size } from './model.ts';
import { StreamDeckError, invalid } from './errors.ts';

const failure = (cause: unknown) => new StreamDeckError({ reason: 'Driver', operation: 'takumi', message: 'React/Takumi rendering failed.', cause });

/** Stateless React view → native HTML/CSS renderer. All platform I/O uses Effect. */
export const make = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const native = yield* Effect.tryPromise({ try: () => import('@takumi-rs/core'), catch: failure });
  const renderer = yield* Effect.try({ try: () => new native.Renderer({ cacheMaxBytes: 4 * 1024 * 1024 }), catch: failure });
  for (const [name, weight] of [['LiberationSans-Regular.ttf', 400], ['LiberationSans-Bold.ttf', 700]] as const) {
    const filename = yield* path.fromFileUrl(new URL(`../assets/fonts/${name}`, import.meta.url));
    const data = yield* fs.readFile(filename);
    yield* Effect.tryPromise({ try: () => renderer.registerFont({ data, name: 'Liberation Sans', weight }), catch: failure });
  }
  const lock = yield* Semaphore.make(1);
  const raster = (view: ReactElement, size: Size, format: 'raw' | 'png') => Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
    if (!Number.isSafeInteger(size.width) || !Number.isSafeInteger(size.height) || size.width <= 0 || size.height <= 0 || size.width * size.height > 4_000_000) {
      return yield* Effect.fail(invalid('takumi', 'Invalid canvas dimensions.'));
    }
    const parsed = yield* Effect.try({ try: () => fromHtml(renderToStaticMarkup(view)), catch: failure });
    return yield* Effect.tryPromise({ try: () => renderer.render(parsed.node, { ...size, format, css: parsed.css, fontFamilies: ['Liberation Sans'] }), catch: failure });
  }).pipe(Effect.uninterruptible));
  return {
    png: (view: ReactElement, size: Size) => raster(view, size, 'png'),
    rgb: (view: ReactElement, size: Size) => Effect.gen(function*() {
      const rgba = yield* raster(view, size, 'raw');
      if (rgba.length !== size.width * size.height * 4) return yield* Effect.fail(failure('Unexpected raw raster size.'));
      const data = new Uint8Array(size.width * size.height * 3);
      for (let src = 0, dest = 0; src < rgba.length; src += 4, dest += 3) {
        data[dest] = rgba[src]!; data[dest + 1] = rgba[src + 1]!; data[dest + 2] = rgba[src + 2]!;
      }
      return { ...size, data } satisfies RgbImage;
    }),
  };
}).pipe(Effect.mapError((cause) => cause instanceof StreamDeckError ? cause : failure(cause)), Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)));
