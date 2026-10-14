import { MAX_VOLUME_PERCENT } from '@nixfiles/system-control/audio-limits.ts';
import { css, volumeColor } from '../volume-gauge.ts';
/** Pure artwork overlay. Timing and audio writes belong to the Spotify service and mixer. */
export function VolumeOverlay({ volume, muted }: { volume: number; muted: boolean }) {
  const level = Math.max(0, Math.min(MAX_VOLUME_PERCENT, volume));
  const length = 2 * Math.PI * 29;
  const color = level > 100 ? css(volumeColor(level)) : '#6FE0A7';
  return (
    <div style={{ position: 'absolute', inset: 0, width: 72, height: 72 }}>
      <div
        style={{
          position: 'absolute',
          left: 4,
          top: 4,
          width: 64,
          height: 64,
          borderRadius: 32,
          background: 'rgba(10,12,17,0.84)',
        }}
      />
      <svg
        width={72}
        height={72}
        viewBox="0 0 72 72"
        style={{ position: 'absolute', inset: 0 }}
        aria-hidden={true}
      >
        <circle cx={36} cy={36} r={29} fill="none" stroke="#FFFFFF30" strokeWidth={3} />
        {level > 0 ? (
          <circle
            cx={36}
            cy={36}
            r={29}
            fill="none"
            stroke={muted ? '#A1A5B0' : color}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={`${(length * level) / MAX_VOLUME_PERCENT} ${length}`}
            transform="rotate(90 36 36)"
          />
        ) : null}
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: css(volumeColor(level)),
          fontFamily: 'Liberation Sans',
          fontSize: 18,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
        }}
      >{`${Math.round(level)} %`}</div>
    </div>
  );
}
