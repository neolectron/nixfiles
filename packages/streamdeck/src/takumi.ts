import { NodeFileSystem, NodePath } from '@effect/platform-node';
import { Context, Effect, FileSystem, Layer, Option, Path, Semaphore } from 'effect';
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
  const cache = new Map<string, Uint8Array>(); let bytes = 0; let renders = 0; let hits = 0;
  const raster = (view: ReactElement, size: Size, format: 'raw' | 'png') => Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
    if (!Number.isSafeInteger(size.width) || !Number.isSafeInteger(size.height) || size.width <= 0 || size.height <= 0 || size.width * size.height > 4_000_000) {
      return yield* Effect.fail(invalid('takumi', 'Invalid canvas dimensions.'));
    }
    const html = yield* Effect.try({ try: () => renderToStaticMarkup(view), catch: failure });
    const key = `${size.width}/${size.height}/${format}/${html}`;
    const existing = cache.get(key);
    if (existing) { cache.delete(key); cache.set(key, existing); hits++; return Uint8Array.from(existing); }
    const parsed = yield* Effect.try({ try: () => fromHtml(html), catch: failure });
    renders++;
    const result = yield* Effect.tryPromise({ try: () => renderer.render(parsed.node, { ...size, format, css: parsed.css, fontFamilies: ['Liberation Sans'] }), catch: failure });
    if (result.length <= 8 * 1024 * 1024) {
      while (cache.size && (cache.size >= 64 || bytes + result.length > 8 * 1024 * 1024)) { const first = cache.keys().next().value!; bytes -= cache.get(first)!.length; cache.delete(first); }
      cache.set(key, Uint8Array.from(result)); bytes += result.length;
    }
    return result;
  }).pipe(Effect.uninterruptible));
  return {
    stats: Effect.sync(() => ({ renders, hits, entries: cache.size, bytes })),
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

export class ReactRenderer extends Context.Service<ReactRenderer, Effect.Success<typeof make>>()('@nixfiles/streamdeck/ReactRenderer') {
  static readonly layer = Layer.effect(ReactRenderer, make);
}
/** Use the session renderer when supplied; standalone scripts keep a scoped fallback. */
export const current = Effect.flatMap(Effect.serviceOption(ReactRenderer), Option.match({ onSome: Effect.succeed, onNone: () => make }));
