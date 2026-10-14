import { Schema } from 'effect';
import * as Presentation from '../presentation.tsx';
export const Data = Schema.Struct({
  width: Presentation.Dimension,
  height: Presentation.Dimension,
  application: Schema.String,
  title: Schema.String,
  icon: Schema.NullOr(Schema.String),
});
export function WindowCard({ value }: { value: typeof Data.Type }) {
  return (
    <div
      style={{
        width: value.width,
        height: value.height,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '12px 18px',
        boxSizing: 'border-box',
        background: '#24262d',
        color: '#eeeef2',
        fontFamily: 'Liberation Sans, sans-serif',
        overflow: 'hidden',
        borderRadius: 8,
      }}
    >
      {value.icon ? (
        <img
          src={value.icon}
          width={40}
          height={40}
          alt=""
          style={{ objectFit: 'contain', flexShrink: 0 }}
        />
      ) : (
        <svg
          width={36}
          height={36}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#c6c8d0"
          strokeWidth={1.5}
          style={{ flexShrink: 0 }}
        >
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M3 9h18" />
        </svg>
      )}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            fontSize: 15,
            color: '#aaaebc',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {value.application || 'Bureau'}
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {value.title || 'Aucune fenêtre active'}
        </div>
      </div>
    </div>
  );
}
export const presentation = Presentation.define('system.window.v1', Data, WindowCard);
