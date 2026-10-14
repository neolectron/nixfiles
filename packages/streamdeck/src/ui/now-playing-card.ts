import { createElement as h } from 'react';
import type { Size } from '../model.ts';
import type { Application } from '../audio.ts';
import type { State } from '../mpris.ts';
import { VolumeOverlay } from './volume-overlay.ts';

export const timestamp = (micros: number | null) =>
  micros === null
    ? '—:—'
    : `${Math.floor(micros / 60_000_000)}:${String(Math.floor(micros / 1_000_000) % 60).padStart(2, '0')}`;
/** Pure Spotify presentation; metadata, time and touch state are owned by its Effect service. */
export function NowPlayingCard({
  width,
  height,
  app,
  track,
  position,
  cover,
  volumeOverlay = false,
}: Size & { app: Application; track: State; position: number | null; cover?: string | undefined; volumeOverlay?: boolean }) {
  const wide = width >= 320;
  const artworkArea = wide || volumeOverlay;
  const textLeft = artworkArea ? 94 : 10;
  const known =
    position !== null &&
    track.durationMicros !== null &&
    track.durationMicros > 0;
  const ratio = known
    ? Math.max(0, Math.min(1, position / track.durationMicros!))
    : 0;
  return h(
    'div',
    {
      style: {
        width,
        height,
        position: 'relative',
        background: '#0D0D10',
        fontFamily: 'Liberation Sans',
      },
    },
    h(
      'div',
      {
        style: {
          position: 'absolute',
          left: 4,
          top: 4,
          width: width - 8,
          height: height - 8,
          borderRadius: 7,
          overflow: 'hidden',
          background: 'linear-gradient(#41414D,#35353F)',
        },
      },
      artworkArea ? h('div', { style: { position: 'absolute', left: 10, top: 10, width: 72, height: 72, borderRadius: 5, overflow: 'hidden', background: '#282A33' } },
        cover ? h('img', { src: cover, alt: '', width: 72, height: 72, style: { width: 72, height: 72, objectFit: 'cover' } }) : null,
        volumeOverlay ? h(VolumeOverlay, { volume: app.volume, muted: app.muted }) : null) : null,
      h(
        'div',
        {
          style: {
            position: 'absolute',
            left: textLeft,
            right: 10,
            top: 8,
            height: 12,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          },
        },
        h(
          'span',
          { style: { fontSize: 10, fontWeight: 700, color: '#80DCAA' } },
          app.name,
        ),
        h(
          'span',
          { style: { fontSize: 9, color: app.muted ? '#F1ADB1' : '#C5C6CF' } },
          app.muted
            ? 'MUET'
            : track.status === 'Paused'
              ? 'PAUSE'
              : track.status === 'Stopped'
                ? 'ARRÊT'
                : app.streams.length
                  ? `${Math.round(app.volume)} %`
                  : 'LECTURE',
        ),
      ),
      h(
        'div',
        {
          style: {
            position: 'absolute',
            left: textLeft,
            right: 10,
            top: 25,
            height: 19,
            fontSize: wide ? 18 : width < 180 ? 13 : 15,
            fontWeight: 700,
            color: '#F4F4F7',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          },
        },
        track.title || 'Aucune piste',
      ),
      h(
        'div',
        {
          style: {
            position: 'absolute',
            left: textLeft,
            right: 10,
            top: 45,
            height: 15,
            fontSize: wide ? 13 : 11,
            color: '#D0D1DB',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          },
        },
        track.artists.join(', ') || 'Artiste inconnu',
      ),
      h(
        'div',
        {
          style: {
            position: 'absolute',
            left: textLeft,
            right: 10,
            top: 65,
            height: 3,
            borderRadius: 2,
            background: '#24252B',
            overflow: 'hidden',
          },
        },
        known
          ? h('div', {
              style: {
                width: `${ratio * 100}%`,
                height: 3,
                background: '#67D995',
              },
            })
          : null,
      ),
      h(
        'div',
        {
          style: {
            position: 'absolute',
            left: textLeft,
            right: 10,
            top: 74,
            height: 12,
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 10,
            color: '#B8BAC5',
            fontVariantNumeric: 'tabular-nums',
          },
        },
        h('span', {}, timestamp(position)),
        h('span', {}, timestamp(track.durationMicros)),
      ),
    ),
  );
}
