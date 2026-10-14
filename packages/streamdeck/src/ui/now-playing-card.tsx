import { invariant } from '../errors.ts';
import type { Size } from '../model.ts';
import type { State } from '@nixfiles/system-control/mpris.ts';
import { VolumeOverlay } from './volume-overlay.tsx';
export const timestamp = (micros: number | null) =>
  micros === null
    ? '—:—'
    : `${Math.floor(micros / 60000000)}:${String(Math.floor(micros / 1000000) % 60).padStart(2, '0')}`;
/** Pure Spotify presentation; metadata, time and touch state are owned by its Effect service. */
export function NowPlayingCard({
  width,
  height,
  app,
  track,
  position,
  cover,
  volumeOverlay = false,
}: Size & {
  app: { name: string; volume: number; muted: boolean; hasAudio: boolean };
  track: Pick<State, 'title' | 'artists' | 'status' | 'durationMicros'>;
  position: number | null;
  cover?: string | undefined;
  volumeOverlay?: boolean;
}) {
  const wide = width >= 320;
  const artworkArea = wide || volumeOverlay;
  const textLeft = artworkArea ? 94 : 10;
  const known = position !== null && track.durationMicros !== null && track.durationMicros > 0;
  const ratio = known
    ? Math.max(0, Math.min(1, position / invariant(track.durationMicros, 'now-playing-card')))
    : 0;
  return (
    <div
      style={{
        width,
        height,
        position: 'relative',
        background: '#0D0D10',
        fontFamily: 'Liberation Sans',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 4,
          top: 4,
          width: width - 8,
          height: height - 8,
          borderRadius: 7,
          overflow: 'hidden',
          background: 'linear-gradient(#41414D,#35353F)',
        }}
      >
        {artworkArea ? (
          <div
            style={{
              position: 'absolute',
              left: 10,
              top: 10,
              width: 72,
              height: 72,
              borderRadius: 5,
              overflow: 'hidden',
              background: '#282A33',
            }}
          >
            {cover ? (
              <img
                src={cover}
                alt=""
                width={72}
                height={72}
                style={{ width: 72, height: 72, objectFit: 'cover' }}
              />
            ) : null}
            {volumeOverlay ? <VolumeOverlay volume={app.volume} muted={app.muted} /> : null}
          </div>
        ) : null}
        <div
          style={{
            position: 'absolute',
            left: textLeft,
            right: 10,
            top: 8,
            height: 12,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 700, color: '#80DCAA' }}>{app.name}</span>
          <span style={{ fontSize: 9, color: app.muted ? '#F1ADB1' : '#C5C6CF' }}>
            {app.muted
              ? 'MUET'
              : track.status === 'Paused'
                ? 'PAUSE'
                : track.status === 'Stopped'
                  ? 'ARRÊT'
                  : app.hasAudio
                    ? `${Math.round(app.volume)} %`
                    : 'LECTURE'}
          </span>
        </div>
        <div
          style={{
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
          }}
        >
          {track.title || 'Aucune piste'}
        </div>
        <div
          style={{
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
          }}
        >
          {track.artists.join(', ') || 'Artiste inconnu'}
        </div>
        <div
          style={{
            position: 'absolute',
            left: textLeft,
            right: 10,
            top: 65,
            height: 3,
            borderRadius: 2,
            background: '#24252B',
            overflow: 'hidden',
          }}
        >
          {known ? (
            <div
              style={{
                width: `${ratio * 100}%`,
                height: 3,
                background: '#67D995',
              }}
            />
          ) : null}
        </div>
        <div
          style={{
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
          }}
        >
          <span>{timestamp(position)}</span>
          <span>{timestamp(track.durationMicros)}</span>
        </div>
      </div>
    </div>
  );
}
