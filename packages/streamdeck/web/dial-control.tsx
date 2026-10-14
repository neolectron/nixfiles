import { useId } from 'react';
import type { Snapshot } from '../src/studio-contract.ts';
import { useDialInput } from './use-dial-input.ts';

type Dial = Snapshot['dials'][number];

/** Encoder feedback is cumulative, independent of volume, assignment and gain limits. */
export function DialControl({
  dial,
  lcdWidth,
  selected,
  disabled,
  onSelect,
  page,
  sessionId,
  onSnapshot,
  onError,
}: {
  dial: Dial;
  lcdWidth: number;
  selected: boolean;
  disabled: boolean;
  onSelect: (index: number) => void;
  page: number;
  sessionId: string;
  onSnapshot: (snapshot: Snapshot) => void;
  onError: (error: unknown) => void;
}) {
  const finishId = useId();
  const { element, handlers } = useDialInput({
    dial,
    page,
    sessionId,
    disabled,
    onSelect,
    onSnapshot,
    onError,
  });
  return (
    <button
      ref={element}
      type="button"
      className={`dial-control${selected ? ' selected' : ''}${dial.pressed ? ' pressed' : ''}`}
      style={{ width: `${(dial.width / lcdWidth) * 100}%` }}
      aria-label={`Potard ${dial.index + 1} · ${dial.name ?? 'aucune application'}`}
      disabled={disabled}
      title="Glisser à droite pour augmenter, à gauche pour diminuer. Molette ou flèches ← →."
      {...handlers}
    >
      <svg viewBox="0 0 64 64" className="knob" aria-hidden={true}>
        <defs>
          <radialGradient id={`${finishId}-cap`} cx="35%" cy="25%" r="80%">
            <stop offset="0" stopColor="#393b3c" />
            <stop offset="0.65" stopColor="#242628" />
            <stop offset="1" stopColor="#151719" />
          </radialGradient>
          <linearGradient id={`${finishId}-rim`} x1="0" y1="0" x2="0.8" y2="1">
            <stop offset="0" stopColor="#55585a" />
            <stop offset="0.3" stopColor="#242628" />
            <stop offset="1" stopColor="#0d0f11" />
          </linearGradient>
        </defs>
        <g className="knob-rotor" style={{ transform: `rotate(${dial.rotationSteps * 15}deg)` }}>
          <circle
            className="knob-rim"
            cx={32}
            cy={32}
            r={27}
            fill={`url(#${finishId}-rim)`}
            stroke="#45484a"
            strokeWidth={1}
          />
          {Array.from({ length: 24 }, (_, i) => (
            <path
              key={i}
              d="M32 5v4"
              stroke="#777b7d"
              strokeWidth={1}
              transform={`rotate(${i * 15} 32 32)`}
            />
          ))}
          <circle
            className="knob-cap"
            cx={32}
            cy={32}
            r={21}
            fill={`url(#${finishId}-cap)`}
            stroke="#0a0b0c"
          />
          <path d="M32 14v8" stroke="#D8D9DF" strokeWidth={2} strokeLinecap="round" />
        </g>
      </svg>
      <span>{dial.master ? 'Master' : `Potard ${dial.index + 1}`}</span>
    </button>
  );
}
