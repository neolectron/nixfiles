import type { ReactNode } from 'react';
import { LcdCard } from './lcd-card.tsx';
import type { Size } from '../model.ts';
import type { Feedback } from '../mixer-display.ts';
import {
  MAX_MASTER_VOLUME_PERCENT,
  MAX_VOLUME_PERCENT,
} from '@nixfiles/system-control/audio-limits.ts';
import { arc, css, point, volumeColor } from '../volume-gauge.ts';
interface CardProps extends Size {
  readonly app: Feedback | undefined;
  readonly online: boolean;
  readonly title: string | undefined;
  readonly icons: Readonly<Record<string, string>>;
  readonly iconFor?: (key: string, online: boolean) => ReactNode;
}
/** Pure React presentation: Effect owns the state and physical event handlers. */
export function VolumeCard({ width, height, app, online, title, icons, iconFor }: CardProps) {
  const master = title === 'MASTER' || title === 'Master';
  if (!app && !master) return <LcdCard width={width} height={height} />;
  const maximum = master ? MAX_MASTER_VOLUME_PERCENT : MAX_VOLUME_PERCENT;
  const name = master ? 'Master' : (title ?? app?.name ?? (online ? 'No app' : 'Audio'));
  const muted = app?.muted ?? false;
  const active = !!app && online && !muted;
  const level = active ? Math.min(maximum, app.volume) : 0;
  const center = width <= 180 ? 50 : 64;
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
  const tint = !online || !app || muted ? '#B8BAC5' : css(volumeColor(app.volume, maximum));
  const a = point(center, 17, app?.volume ?? 0, maximum);
  const b = point(center, 27, app?.volume ?? 0, maximum);
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const percent = i <= 5 ? i * 20 : 100 + ((i - 5) / 5) * (maximum - 100);
    const from = point(center, 40, percent, maximum);
    const to = point(center, i === 5 ? 45 : 43, percent, maximum);
    return (
      <path
        key={i}
        d={`M ${from[0]} ${from[1]} L ${to[0]} ${to[1]}`}
        stroke={i === 5 ? '#B8BAC5' : '#727582'}
        strokeWidth={i === 5 ? 1.8 : 1.2}
      />
    );
  });
  const boost = Array.from({ length: Math.max(0, Math.ceil((level - 100) / 2)) }, (_, i) => {
    const from = 100 + i * 2;
    const to = Math.min(level, from + 2);
    return (
      <path
        key={i}
        d={arc(center, 34, from, to, maximum)}
        stroke={css(volumeColor(to, maximum))}
        strokeWidth={5.5}
        fill="none"
      />
    );
  });
  const lower = name.toLowerCase();
  const key = lower.includes('spotify')
    ? 'spotify'
    : lower.includes('discord')
      ? 'discord'
      : lower.includes('chrome')
        ? 'googlechrome'
        : undefined;
  const symbol =
    master || muted || !key ? (
      <svg width={19} height={19} viewBox="0 0 24 24">
        <path
          d={
            master || muted
              ? 'M 2 8 H 6 L 11 4 V 20 L 6 16 H 2 Z M 15 8 Q 19 12 15 16'
              : 'M 9 16 V 5 L 20 3 V 14 M 9 8 L 20 6'
          }
          fill="none"
          stroke={online ? '#D8D9E4' : '#DBB45A'}
          strokeWidth={1.8}
        />
        {muted ? <path d="M 14 7 L 23 17 M 23 7 L 14 17" stroke="#F1ADB1" strokeWidth={2} /> : null}
      </svg>
    ) : (
      (iconFor?.(key, online) ?? (
        <img
          alt=""
          src={icons[key]}
          width={19}
          height={19}
          style={{ opacity: online ? 1 : 0.45 }}
        />
      ))
    );
  return (
    <LcdCard width={width} height={height}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginLeft: 10,
          marginTop: 8,
          height: 21,
        }}
      >
        {symbol}
        <span
          style={{
            width: width - 57,
            color: online && app ? '#F4F4F7' : '#B8BAC5',
            fontSize: 15,
            fontWeight: 700,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {name}
        </span>
      </div>
      <svg
        width={center * 2}
        height={64}
        viewBox={`0 35 ${center * 2} 64`}
        style={{ position: 'absolute', top: 31, left: -4 }}
      >
        {ticks}
        <path
          d={arc(center, 34, 0, maximum, maximum)}
          stroke="#24252B"
          strokeWidth={6}
          fill="none"
          strokeLinecap="round"
        />
        <path
          d={`M ${center - 27} 91 A 27 27 0 0 1 ${center + 27} 91 Z`}
          fill={active ? '#4E5963' : '#44464F'}
        />
        {level ? (
          <path
            d={arc(center, 34, 0, Math.min(100, level), maximum)}
            stroke="#38E51E"
            strokeWidth={5.5}
            fill="none"
            strokeLinecap="round"
          />
        ) : null}
        {boost}
        <path
          d={`M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}`}
          stroke={active ? '#F5F5EA' : '#888A97'}
          strokeWidth={2.4}
          strokeLinecap="round"
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          top: 34,
          left: center + 32,
          right: 11,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'flex-end',
          alignItems: 'baseline',
          columnGap: 4,
        }}
      >
        <span
          style={{
            fontSize: 30,
            fontWeight: 700,
            color: tint,
            lineHeight: '33px',
            flexShrink: 0,
          }}
        >
          {app && online ? Math.round(app.volume) : '—'}
        </span>
        <span
          style={{
            fontSize: status === '%' ? 13 : 11,
            fontWeight: 700,
            color: muted ? '#E7B1B8' : '#C5C6CF',
            lineHeight: '17px',
            flexShrink: 0,
            ...(status === '%' ? {} : { flexBasis: '100%', textAlign: 'right' }),
          }}
        >
          {status}
        </span>
      </div>
    </LcdCard>
  );
}
