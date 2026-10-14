import { NodeFileSystem, NodePath } from '@effect/platform-node';
import { Effect, FileSystem, Layer, Path } from 'effect';
import { StreamDeckError, invalid } from './errors.ts';
import type { Size } from './model.ts';
import * as Svg from './svg.ts';
import { MAX_MASTER_VOLUME_PERCENT, MAX_VOLUME_PERCENT } from '@nixfiles/system-control/audio.ts';
import { volumeColor, point, arc, css } from './volume-gauge.ts';

export interface Feedback {
  readonly name: string;
  readonly volume: number;
  readonly muted: boolean;
  readonly mixedMute?: boolean;
}
const speaker = `<path d="M 2 8 H 6 L 11 4 V 20 L 6 16 H 2 Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M 15 8 Q 19 12 15 16 M 18 5 Q 25 12 18 19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>`;
const music = `<path d="M 9 16 V 5 L 20 3 V 14 M 9 8 L 20 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><ellipse cx="6" cy="17" rx="3" ry="2.6" fill="currentColor"/><ellipse cx="17" cy="15" rx="3" ry="2.6" fill="currentColor"/>`;

/** Reference-led mixer cards; rendering has no access to audio or the device. */
export const make = Effect.gen(function* () {
  const renderer = yield* Svg.make;
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const icons = yield* Effect.forEach(['spotify', 'discord', 'googlechrome'] as const, (name) =>
    Effect.gen(function* () {
      const filename = yield* pathService.fromFileUrl(
        new URL(`../assets/icons/${name}.svg`, import.meta.url),
      );
      const svg = yield* fs.readFileString(filename);
      const path = svg.match(/<path d="([^"]+)"/u)?.[1];
      if (!path) return yield* Effect.fail(invalid('mixer-icon', `Invalid bundled ${name} icon.`));
      return [name, path] as const;
    }),
  );
  const paths = Object.fromEntries(icons);
  const icon = (name: string, master: boolean, muted: boolean, online: boolean, empty: boolean) => {
    const lower = name.toLowerCase();
    const key = lower.includes('spotify')
      ? 'spotify'
      : lower.includes('discord')
        ? 'discord'
        : lower.includes('chrome')
          ? 'googlechrome'
          : undefined;
    const accent = !online
      ? '#DBB45A'
      : empty || muted
        ? '#ACADB8'
        : master
          ? '#E7E9ED'
          : key === 'spotify'
            ? '#1ED760'
            : key === 'discord'
              ? '#8B83FF'
              : key === 'googlechrome'
                ? '#F7C65A'
                : '#E884CA';
    const symbol =
      muted || master ? speaker : key ? `<path d="${paths[key]}" fill="currentColor"/>` : music;
    return `<g transform="translate(14 12) scale(.8)" color="${accent}">${symbol}${muted ? '<path d="M 14 7 L 23 17 M 23 7 L 14 17" stroke="#F1ADB1" stroke-width="2"/>' : ''}</g>`;
  };
  const svg = (size: Size, app: Feedback | undefined, online: boolean, titleOverride?: string) =>
    Effect.gen(function* () {
      if (
        !Number.isSafeInteger(size.width) ||
        !Number.isSafeInteger(size.height) ||
        size.width < 128 ||
        size.height < 64 ||
        size.width * size.height > 4_000_000 ||
        (app && (!Number.isFinite(app.volume) || app.volume < 0))
      )
        return yield* Effect.fail(invalid('mixer-card', 'Invalid feedback or card dimensions.'));
      const master = titleOverride === 'MASTER' || titleOverride === 'Master';
      if (!app && !master)
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}"><rect width="100%" height="100%" fill="#0D0D10"/></svg>`;
      const maximum = master ? MAX_MASTER_VOLUME_PERCENT : MAX_VOLUME_PERCENT;
      const title = master
        ? 'Master'
        : (titleOverride ?? app?.name ?? (online ? 'No app' : 'Audio'));
      const label = yield* renderer.fit(title.replace(/\s+/g, ' ').trim(), size.width - 57, 15);
      const center = size.width <= 180 ? 62 : 80;
      const radius = 34;
      const muted = app?.muted ?? false;
      const active = !!app && online && !muted;
      const level = active ? Math.min(maximum, app.volume) : 0;
      const ticks = Array.from({ length: 11 }, (_, i) => {
        const percent = i <= 5 ? i * 20 : 100 + ((i - 5) / 5) * (maximum - 100);
        const a = point(center, radius + 6, percent, maximum);
        const b = point(center, radius + (i === 5 ? 11 : 9), percent, maximum);
        return `<path d="M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}" stroke="${i === 5 ? '#B8BAC5' : '#727582'}" stroke-width="${i === 5 ? 1.8 : 1.2}"/>`;
      }).join('');
      const nominal = level
        ? `<path d="${arc(center, radius, 0, Math.min(100, level), maximum)}" stroke="#38E51E" stroke-width="5.5" fill="none" stroke-linecap="round"/>`
        : '';
      const boost = Array.from({ length: Math.max(0, Math.ceil((level - 100) / 2)) }, (_, i) => {
        const from = 100 + i * 2;
        const to = Math.min(level, from + 2);
        return `<path d="${arc(center, radius, from, to, maximum)}" stroke="${css(volumeColor(to, maximum))}" stroke-width="5.5" fill="none"/>`;
      }).join('');
      const pointerA = point(center, 17, app?.volume ?? 0, maximum);
      const pointerB = point(center, 27, app?.volume ?? 0, maximum);
      const percent = app && online ? String(Math.round(app.volume)) : '—';
      const status = !online
        ? 'Offline'
        : !app
          ? master
            ? 'No output'
            : ''
          : muted
            ? 'Muted'
            : app.mixedMute
              ? 'Mixed'
              : '%';
      const numberColor =
        !online || !app || muted ? '#B8BAC5' : css(volumeColor(app.volume, maximum));
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} 100">
      <defs><linearGradient id="surface" x2="0" y2="1"><stop stop-color="#41414D"/><stop offset="1" stop-color="#35353F"/></linearGradient><clipPath id="card"><rect x="4" y="4" width="${size.width - 8}" height="92" rx="7"/></clipPath></defs>
      <rect width="${size.width}" height="100" fill="#0D0D10"/>
      <g clip-path="url(#card)"><rect x="4" y="4" width="${size.width - 8}" height="92" rx="7" fill="url(#surface)"/>
      ${icon(title, master, muted, online, !app)}
      <text x="40" y="28" font-family="${Svg.fontFamily}" font-size="15" font-weight="700" fill="${online && app ? '#F4F4F7' : '#B8BAC5'}">${Svg.escapeXml(label)}</text>
      ${ticks}<path d="${arc(center, radius, 0, maximum, maximum)}" stroke="#24252B" stroke-width="6" fill="none" stroke-linecap="round"/>
      <path d="M ${center - 27} 91 A 27 27 0 0 1 ${center + 27} 91 Z" fill="${active ? '#4E5963' : '#44464F'}"/>
      ${nominal}${boost}
      <path d="M ${pointerA[0]} ${pointerA[1]} L ${pointerB[0]} ${pointerB[1]}" stroke="${active ? '#F5F5EA' : '#888A97'}" stroke-width="2.4" stroke-linecap="round"/>
      <text x="${size.width - 15}" y="70" text-anchor="end" font-family="${Svg.fontFamily}" font-size="30" font-weight="700" fill="${numberColor}">${percent}</text>
      <text x="${size.width - 15}" y="87" text-anchor="end" font-family="${Svg.fontFamily}" font-size="${status === '%' ? 13 : 11}" font-weight="700" fill="${muted ? '#E7B1B8' : '#C5C6CF'}">${status}</text>
      </g></svg>`;
    });
  return {
    svg,
    renderer,
    card: (size: Size, app: Feedback | undefined, online: boolean, titleOverride?: string) =>
      Effect.flatMap(svg(size, app, online, titleOverride), renderer.rgb),
    png: (size: Size, app: Feedback | undefined, online: boolean, titleOverride?: string) =>
      Effect.flatMap(svg(size, app, online, titleOverride), renderer.png),
  };
}).pipe(
  Effect.mapError((cause) =>
    cause instanceof StreamDeckError
      ? cause
      : new StreamDeckError({
          reason: 'Driver',
          operation: 'mixer-assets',
          message: 'Could not load bundled mixer assets.',
          cause,
        }),
  ),
  Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
);
export const card = (
  size: Size,
  app: Feedback | undefined,
  online: boolean,
  titleOverride?: string,
) => Effect.flatMap(make, (display) => display.card(size, app, online, titleOverride));
