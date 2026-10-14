import type { ActionId, BindingStatus } from '../studio-contract.ts';
import type { KeyFeedback } from '../key-feedback.ts';
import { FeedbackIcon } from './feedback-icon.tsx';
export function KeyCard({
  width,
  height,
  label,
  action,
  count,
  status,
  feedback,
}: {
  readonly width: number;
  readonly height: number;
  readonly label: string;
  readonly action: ActionId;
  readonly count: number;
  readonly status: BindingStatus;
  readonly feedback?: KeyFeedback | null;
}) {
  const color =
    feedback?.tone === 'danger'
      ? '#FFA8A2'
      : feedback?.tone === 'positive'
        ? '#96DCB2'
        : feedback
          ? '#BFC2CA'
          : status === 'error'
            ? '#FFA8A2'
            : status === 'running'
              ? '#E8BC78'
              : '#F0F1F4';
  const icon =
    action === 'counter' ? (
      <span style={{ fontSize: 37, fontWeight: 700, color, lineHeight: '46px' }}>{count}</span>
    ) : feedback ? (
      <FeedbackIcon feedback={feedback} color={color} />
    ) : (
      <svg width={39} height={39} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5}>
        {action === 'run-command' ? (
          [<path key="a" d="m4 6 6 6-6 6" />, <path key="b" d="M13 18h7" />]
        ) : action === 'plugin' ? (
          <path d="M9 3v5H4v8h5v5h7v-5h5V8h-5V3ZM9 8h7v8H9Z" />
        ) : action === 'open-folder' ? (
          <path d="M3 6h7l2 3h9v11H3ZM3 6V4h7l2 2h9v3" />
        ) : action === 'go-back' ? (
          <path d="m10 5-7 7 7 7M3 12h12a6 6 0 0 1 6 6" />
        ) : action === 'page-next' ? (
          <path d="m9 4 8 8-8 8" />
        ) : action === 'page-previous' ? (
          <path d="m15 4-8 8 8 8" />
        ) : (
          [
            <rect key="a" x={3} y={3} width={7} height={7} rx={1} />,
            <rect key="b" x={14} y={3} width={7} height={7} rx={1} />,
            <rect key="c" x={3} y={14} width={7} height={7} rx={1} />,
            <path key="d" d="M14 17h7m-3-3 3 3-3 3" />,
          ]
        )}
      </svg>
    );
  return (
    <div
      style={{
        width,
        height,
        background: '#272931',
        color,
        fontFamily: 'Liberation Sans',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: feedback ? 4 : 8,
        padding: 9,
      }}
    >
      {icon}
      <span
        style={{
          fontSize: 13,
          fontWeight: 700,
          textAlign: 'center',
          lineHeight: '16px',
          overflow: 'hidden',
          maxHeight: 32,
          width: width - 18,
        }}
      >
        {feedback?.label ?? label}
      </span>
      {feedback ? (
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            lineHeight: '12px',
            textAlign: 'center',
            overflow: 'hidden',
            maxHeight: 12,
            width: width - 18,
            color: feedback.tone === 'neutral' ? '#BFC2CA' : color,
          }}
        >
          {feedback.text}
        </span>
      ) : null}
    </div>
  );
}
