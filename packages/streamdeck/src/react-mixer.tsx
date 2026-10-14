import { NodeFileSystem, NodePath } from '@effect/platform-node';
import { Effect, FileSystem, Layer, Path } from 'effect';
import { Base64 } from 'effect/encoding';
import { VolumeCard } from './ui/volume-card.tsx';
import type { Size } from './model.ts';
import type { Feedback } from './mixer-display.ts';
import * as Takumi from './takumi.ts';
import { StreamDeckError, invalid } from './errors.ts';
export const make = Effect.gen(function* () {
  const renderer = yield* Takumi.current;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entries = yield* Effect.forEach(
    [
      ['spotify', '#1ED760'],
      ['discord', '#8B83FF'],
      ['googlechrome', '#F7C65A'],
    ] as const,
    ([name, color]) =>
      Effect.gen(function* () {
        const filename = yield* path.fromFileUrl(
          new URL(`../assets/icons/${name}.svg`, import.meta.url),
        );
        const svg = (yield* fs.readFileString(filename)).replace('<svg ', `<svg fill="${color}" `);
        return [name, `data:image/svg+xml;base64,${Base64.encode(svg)}`] as const;
      }),
  );
  const icons = Object.fromEntries(entries);
  const view = (size: Size, app: Feedback | undefined, online: boolean, title?: string) =>
    Effect.gen(function* () {
      if (
        size.width < 128 ||
        size.height < 64 ||
        (app && (!Number.isFinite(app.volume) || app.volume < 0))
      )
        return yield* Effect.fail(invalid('react-card', 'Invalid feedback or card size.'));
      return <VolumeCard {...size} app={app} online={online} title={title} icons={icons} />;
    });
  return {
    card: (size: Size, app: Feedback | undefined, online: boolean, title?: string) =>
      Effect.flatMap(view(size, app, online, title), (element) => renderer.rgb(element, size)),
    png: (size: Size, app: Feedback | undefined, online: boolean, title?: string) =>
      Effect.flatMap(view(size, app, online, title), (element) => renderer.png(element, size)),
  };
}).pipe(
  Effect.mapError((cause) =>
    cause instanceof StreamDeckError
      ? cause
      : new StreamDeckError({
          reason: 'Driver',
          operation: 'react-assets',
          message: 'Could not load React mixer assets.',
          cause,
        }),
  ),
  Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
);
