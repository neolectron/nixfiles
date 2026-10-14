import { Config, Context, Effect, FileSystem, Layer, Path } from 'effect';

/** XDG application icons, independent of any deck or renderer. No network or shell lookup. */
export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* Config.String('HOME');
  const dataHome = yield* Config.String('XDG_DATA_HOME').pipe(
    Config.withDefault(path.join(home, '.local/share')),
  );
  const dataDirs = yield* Config.String('XDG_DATA_DIRS').pipe(
    Config.withDefault('/usr/local/share:/usr/share'),
  );
  const roots = [
    path.join(home, '.icons'),
    ...[dataHome, ...dataDirs.split(':')].map((root) => path.join(root, 'icons')),
  ];
  const cache = new Map<string, { bytes: Uint8Array; contentType: string } | undefined>();
  const resolve = (icon: string) =>
    Effect.gen(function* () {
      if (cache.has(icon)) return cache.get(icon);
      const candidates: string[] = [];
      if (path.isAbsolute(icon)) candidates.push(icon);
      else if (/^[\w.+-]+$/.test(icon)) {
        for (const root of roots)
          for (const theme of ['Papirus-Dark', 'Papirus', 'hicolor', 'Adwaita', 'breeze'])
            for (const size of [
              'scalable',
              '128x128',
              '256x256',
              '512x512',
              '64x64',
              '48x48',
              '32x32',
              '24x24',
              'symbolic',
            ])
              for (const extension of ['svg', 'png'])
                candidates.push(path.join(root, theme, size, 'apps', `${icon}.${extension}`));
        for (const root of [dataHome, ...dataDirs.split(':')])
          for (const extension of ['png', 'svg'])
            candidates.push(path.join(root, 'pixmaps', `${icon}.${extension}`));
      }
      let result: { bytes: Uint8Array; contentType: string } | undefined;
      for (const filename of candidates) {
        const stat = yield* fs.stat(filename).pipe(Effect.orElseSucceed(() => undefined));
        if (!stat || Number(stat.size) > 1048576) continue;
        const contentType = filename.endsWith('.svg')
          ? 'image/svg+xml'
          : filename.endsWith('.png')
            ? 'image/png'
            : undefined;
        if (!contentType) continue;
        const bytes = yield* fs.readFile(filename).pipe(Effect.orElseSucceed(() => undefined));
        if (bytes?.length) {
          result = { bytes, contentType };
          break;
        }
      }
      if (cache.size >= 64) cache.delete(cache.keys().next().value ?? '');
      cache.set(icon, result);
      return result;
    });
  return { resolve };
});
export class DesktopIcons extends Context.Service<DesktopIcons, Effect.Success<typeof make>>()(
  '@nixfiles/system-control/DesktopIcons',
) {
  static readonly layer = Layer.effect(DesktopIcons, make);
}
