import { createElement as h } from 'react';
import type { Snapshot } from '../src/studio-contract.ts';

export const keyRanges = (keys: ReadonlyArray<number>) => {
  const result: string[] = []; const ordered = [...keys].sort((a, b) => a - b);
  for (let index = 0; index < ordered.length; index++) {
    const start = ordered[index]!; let end = start;
    while (ordered[index + 1] === end + 1) end = ordered[++index]!;
    result.push(start === end ? `${start + 1}` : `${start + 1}–${end + 1}`);
  }
  return result.join(', ');
};
export const zoneLabel = (zone: Snapshot['layout']['zones'][number]) => `${zone.name} · touches ${keyRanges(zone.keys)}`;

export function ZoneMap({ snapshot, keys, onToggle, allowed, disabled = false }: {
  snapshot: Snapshot; keys: ReadonlyArray<number>; onToggle?: (key: number) => void; allowed?: ReadonlyArray<number>; disabled?: boolean;
}) {
  const columns = Math.max(...snapshot.keys.map((key) => key.column)) + 1;
  return h('div', { className: 'zone-map', style: { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }, 'aria-label': onToggle ? 'Choisir les touches de la zone' : 'Touches concernées' },
    ...snapshot.keys.map((key) => {
      const included = keys.includes(key.index);
      const props = { key: key.index, className: `zone-map-key${included ? ' included' : ''}${key.pinned ? ' fixed' : ''}`,
        title: `Touche ${key.index + 1}${key.pinned ? ' · fixe' : ''}${included ? ' · dans la zone' : ''}` };
      return onToggle ? h('button', { ...props, type: 'button', 'aria-label': props.title, 'aria-pressed': included,
        disabled: disabled || !allowed?.includes(key.index), onClick: () => onToggle(key.index) }, key.index + 1)
        : h('span', props, key.index + 1);
    }));
}

export function TargetPreview({ snapshot, zoneId, folder = false }: { snapshot: Snapshot; zoneId: string; folder?: boolean }) {
  if (zoneId === 'audio') return h('div', { className: 'target-preview' }, h('strong', {}, 'Mixer audio LCD'),
    h('p', { className: 'field-hint' }, `${snapshot.dials.filter((dial) => !dial.master).length} applications par page. Master reste fixe. Les touches ne changent pas.`));
  const zone = snapshot.layout.zones.find((zone) => zone.id === zoneId);
  if (!zone) return null;
  const fixed = snapshot.keys.filter((key) => key.zone === zone.id && key.pinned).map((key) => key.index);
  const size = zone.keys.length - fixed.length - (folder || zone.folder !== null ? 1 : 0);
  return h('div', { className: 'target-preview' }, h('strong', {}, zoneLabel(zone)), h(ZoneMap, { snapshot, keys: zone.keys }),
    h('p', { className: 'field-hint' }, `${size} icône${size > 1 ? 's' : ''} par page${folder || zone.folder !== null ? ' + Retour' : ''}${fixed.length ? ` · touches ${keyRanges(fixed)} fixes` : ''}.`),
    h('a', { href: '#zones', className: 'zone-edit-link' }, 'Modifier les touches et la taille de la zone'));
}
