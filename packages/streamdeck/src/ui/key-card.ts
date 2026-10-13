import { createElement as h } from 'react';
import type { ActionId, BindingStatus } from '../studio-contract.ts';

export function KeyCard({ width, height, label, action, count, status }: {
  readonly width: number; readonly height: number; readonly label: string;
  readonly action: ActionId; readonly count: number; readonly status: BindingStatus;
}) {
  const color = status === 'error' ? '#FFA8A2' : status === 'running' ? '#E8BC78' : '#F0F1F4';
  const icon = action === 'counter'
    ? h('span', { style: { fontSize: 37, fontWeight: 700, color, lineHeight: '46px' } }, count)
    : h('svg', { width: 39, height: 39, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 1.5 },
      action === 'run-command'
        ? [h('path', { key: 'a', d: 'm4 6 6 6-6 6' }), h('path', { key: 'b', d: 'M13 18h7' })]
        : [h('rect', { key: 'a', x: 3, y: 3, width: 7, height: 7, rx: 1 }), h('rect', { key: 'b', x: 14, y: 3, width: 7, height: 7, rx: 1 }), h('rect', { key: 'c', x: 3, y: 14, width: 7, height: 7, rx: 1 }), h('path', { key: 'd', d: 'M14 17h7m-3-3 3 3-3 3' })]);
  return h('div', { style: { width, height, background: '#272931', color, fontFamily: 'Liberation Sans', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 8, padding: 9 } },
    icon, h('span', { style: { fontSize: 13, fontWeight: 700, textAlign: 'center', lineHeight: '16px', overflow: 'hidden', maxHeight: 32, width: width - 18 } }, label));
}
