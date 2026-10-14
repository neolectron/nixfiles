import { Effect } from 'effect';
import { Base64 } from 'effect/encoding';
import { Resvg } from '@resvg/resvg-js';
import type { DesktopIcons } from '@nixfiles/system-control/desktop-icons.ts';

/** Resolve/rasterize once per icon in the plugin scope; snapshots publish immutable URLs. */
export const make = (icons: typeof DesktopIcons.Service) =>
  Effect.gen(function* () {
    const cache = new Map<string, string | undefined>();
    yield* Effect.addFinalizer(() => Effect.sync(() => cache.clear()));
    return (name: string) =>
      Effect.gen(function* () {
        if (cache.has(name)) return cache.get(name);
        const icon = yield* icons.resolve(name);
        const data = icon
          ? yield* Effect.try({
              try: () => {
                const png =
                  icon.contentType === 'image/svg+xml'
                    ? new Resvg(new TextDecoder().decode(icon.bytes), {
                        fitTo: { mode: 'width', value: 64 },
                      })
                        .render()
                        .asPng()
                    : icon.bytes;
                return `data:image/png;base64,${Base64.encode(png)}`;
              },
              catch: () => undefined,
            }).pipe(Effect.orElseSucceed(() => undefined))
          : undefined;
        if (cache.size >= 32) cache.delete(cache.keys().next().value ?? '');
        cache.set(name, data);
        return data;
      });
  });
