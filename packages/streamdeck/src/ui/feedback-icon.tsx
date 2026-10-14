import type { KeyFeedback } from '../key-feedback.ts';
import { BrandIcon, isBrandIcon } from './brand-icon.tsx';
const mediaIcons: Partial<Record<KeyFeedback['icon'], string>> = {
  play: 'm7 4 14 8-14 8Z',
  pause: 'M6 4h4v16H6ZM14 4h4v16h-4Z',
  stop: 'M5 5h14v14H5Z',
  next: 'm4 5 11 7-11 7ZM19 4v16',
  previous: 'm20 5-11 7 11 7ZM5 4v16',
  shuffle: 'M3 7h3c5 0 7 10 12 10h3m-4-4 4 4-4 4M3 17h3c2 0 3-1 4-3m4-4c1-2 2-3 4-3h3m-4-4 4 4-4 4',
  repeat: 'm17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3',
  music: 'M9 18V5l12-2v13M9 8l12-2M9 18a3 3 0 1 1-3-3h3Zm12-2a3 3 0 1 1-3-3h3Z',
};
export function FeedbackIcon({
  feedback,
  color = 'currentColor',
  size = 39,
}: {
  readonly feedback: KeyFeedback;
  readonly color?: string;
  readonly size?: number;
}) {
  if (isBrandIcon(feedback.icon))
    return <BrandIcon icon={feedback.icon} color={color} size={size} />;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.5}
      aria-hidden="true"
    >
      {feedback.icon === 'microphone' ? (
        [
          <rect key="mic" x={9} y={3} width={6} height={11} rx={3} />,
          <path key="stand" d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />,
          ...(feedback.tone === 'danger' ? [<path key="off" d="M3 3l18 18" />] : []),
        ]
      ) : feedback.icon === 'headphones' ? (
        [
          <path key="band" d="M4 14v-3a8 8 0 0 1 16 0v3M4 12h4v9H4ZM16 12h4v9h-4Z" />,
          ...(feedback.tone === 'danger' ? [<path key="off" d="M3 3l18 18" />] : []),
        ]
      ) : feedback && mediaIcons[feedback.icon] ? (
        <path d={mediaIcons[feedback.icon]} strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M9 3v5H4v8h5v5h7v-5h5V8h-5V3ZM9 8h7v8H9Z" />
      )}
    </svg>
  );
}
