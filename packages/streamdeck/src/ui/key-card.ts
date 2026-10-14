import { createElement as h } from 'react';
import type { ActionId, BindingStatus } from '../studio-contract.ts';
import type { KeyFeedback } from '../key-feedback.ts';

const mediaIcons: Partial<Record<KeyFeedback['icon'], string>> = {
  play: 'm7 4 14 8-14 8Z', pause: 'M6 4h4v16H6ZM14 4h4v16h-4Z', stop: 'M5 5h14v14H5Z',
  next: 'm4 5 11 7-11 7ZM19 4v16', previous: 'm20 5-11 7 11 7ZM5 4v16',
  shuffle: 'M3 7h3c5 0 7 10 12 10h3m-4-4 4 4-4 4M3 17h3c2 0 3-1 4-3m4-4c1-2 2-3 4-3h3m-4-4 4 4-4 4',
  repeat: 'm17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3',
  music: 'M9 18V5l12-2v13M9 8l12-2M9 18a3 3 0 1 1-3-3h3Zm12-2a3 3 0 1 1-3-3h3Z',
};

export function KeyCard({ width, height, label, action, count, status, feedback }: {
  readonly width: number; readonly height: number; readonly label: string;
  readonly action: ActionId; readonly count: number; readonly status: BindingStatus;
  readonly feedback?: KeyFeedback | null;
}) {
  const color = feedback?.tone === 'danger' ? '#FFA8A2' : feedback?.tone === 'positive' ? '#96DCB2' : feedback ? '#BFC2CA' : status === 'error' ? '#FFA8A2' : status === 'running' ? '#E8BC78' : '#F0F1F4';
  const icon = action === 'counter'
    ? h('span', { style: { fontSize: 37, fontWeight: 700, color, lineHeight: '46px' } }, count)
    : h('svg', { width: 39, height: 39, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 1.5 },
      feedback?.icon === 'microphone' ? [h('rect', { key: 'mic', x: 9, y: 3, width: 6, height: 11, rx: 3 }), h('path', { key: 'stand', d: 'M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8' }), ...(feedback.tone === 'danger' ? [h('path', { key: 'off', d: 'M3 3l18 18' })] : [])]
      : feedback?.icon === 'headphones' ? [h('path', { key: 'band', d: 'M4 14v-3a8 8 0 0 1 16 0v3M4 12h4v9H4ZM16 12h4v9h-4Z' }), ...(feedback.tone === 'danger' ? [h('path', { key: 'off', d: 'M3 3l18 18' })] : [])]
      : feedback && mediaIcons[feedback.icon] ? h('path', { d: mediaIcons[feedback.icon], strokeLinecap: 'round', strokeLinejoin: 'round' })
      : action === 'run-command'
        ? [h('path', { key: 'a', d: 'm4 6 6 6-6 6' }), h('path', { key: 'b', d: 'M13 18h7' })]
        : action === 'plugin' ? h('path', { d: 'M9 3v5H4v8h5v5h7v-5h5V8h-5V3ZM9 8h7v8H9Z' })
        : action === 'open-folder' ? h('path', { d: 'M3 6h7l2 3h9v11H3ZM3 6V4h7l2 2h9v3' })
        : action === 'go-back' ? h('path', { d: 'm10 5-7 7 7 7M3 12h12a6 6 0 0 1 6 6' })
        : action === 'page-next' ? h('path', { d: 'm9 4 8 8-8 8' })
        : action === 'page-previous' ? h('path', { d: 'm15 4-8 8 8 8' })
        : [h('rect', { key: 'a', x: 3, y: 3, width: 7, height: 7, rx: 1 }), h('rect', { key: 'b', x: 14, y: 3, width: 7, height: 7, rx: 1 }), h('rect', { key: 'c', x: 3, y: 14, width: 7, height: 7, rx: 1 }), h('path', { key: 'd', d: 'M14 17h7m-3-3 3 3-3 3' })]);
  return h('div', { style: { width, height, background: '#272931', color, fontFamily: 'Liberation Sans', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: feedback ? 4 : 8, padding: 9 } },
    icon, h('span', { style: { fontSize: 13, fontWeight: 700, textAlign: 'center', lineHeight: '16px', overflow: 'hidden', maxHeight: 32, width: width - 18 } }, label),
    feedback ? h('span', { style: { fontSize: 10, fontWeight: 700, lineHeight: '12px', textAlign: 'center', overflow: 'hidden', maxHeight: 12, width: width - 18, color: feedback.tone === 'neutral' ? '#BFC2CA' : color } }, feedback.text) : null);
}
