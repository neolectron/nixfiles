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
      aria-describedby="dial-help"
      {...handlers}
    >
      <svg viewBox="0 0 64 64" className="knob" aria-hidden={true}>
        <g className="knob-rotor" style={{ transform: `rotate(${dial.rotationSteps * 15}deg)` }}>
          <circle cx={32} cy={32} r={27} fill="#2C2E35" stroke="#555863" strokeWidth={2} />
          {Array.from({ length: 24 }, (_, i) => (
            <path
              key={i}
              d="M32 5v4"
              stroke="#6A6D78"
              strokeWidth={1}
              transform={`rotate(${i * 15} 32 32)`}
            />
          ))}
          <circle cx={32} cy={32} r={20} fill="#363942" />
          <path d="M32 14v8" stroke="#D8D9DF" strokeWidth={2} strokeLinecap="round" />
        </g>
      </svg>
      <span>{dial.master ? 'Master' : `Potard ${dial.index + 1}`}</span>
    </button>
  );
}
