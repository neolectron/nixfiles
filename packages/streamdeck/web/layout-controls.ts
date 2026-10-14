import { createElement as h, useState, type FormEvent } from 'react';
import { Effect } from 'effect';
import type { Snapshot } from '../src/studio-contract.ts';
import * as Api from './api.ts';

type KeyView = Snapshot['keys'][number];
type Props = { snapshot: Snapshot; selected: KeyView | undefined; online: boolean; dirty: boolean; onSnapshot: (snapshot: Snapshot) => void };
const message = (error: unknown) => error instanceof Error ? error.message : 'La disposition n’a pas pu être modifiée.';
const numbers = (text: string) => {
  const keys: number[] = [];
  for (const part of text.split(',')) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error('Utilise des numéros de touches, par exemple 1-9, 19-27.');
    const start = Number(match[1]); const end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || end - start > 100) throw new Error('La plage de touches est invalide.');
    for (let key = start; key <= end; key++) keys.push(key - 1);
  }
  return [...new Set(keys)];
};
const Arrow = ({ previous = false }: { previous?: boolean }) => h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true }, h('path', { d: previous ? 'm14 5-7 7 7 7' : 'm10 5 7 7-7 7' }));
const keyRanges = (keys: ReadonlyArray<number>) => {
  const result: string[] = []; const ordered = [...keys].sort((a, b) => a - b);
  for (let index = 0; index < ordered.length; index++) {
    const start = ordered[index]!; let end = start;
    while (ordered[index + 1] === end + 1) end = ordered[++index]!;
    result.push(start === end ? `${start + 1}` : `${start + 1}–${end + 1}`);
  }
  return result.join(', ');
};

export function LayoutControls({ snapshot, selected, online, dirty, onSnapshot }: Props) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [folderName, setFolderName] = useState(''); const [zoneName, setZoneName] = useState(''); const [zoneKeys, setZoneKeys] = useState('');
  const [renameId, setRenameId] = useState(''); const [rename, setRename] = useState('');
  const disabled = busy || dirty || !online;
  const run = async (effect: Effect.Effect<Snapshot, unknown>) => {
    setBusy(true); setError('');
    try { onSnapshot(await Effect.runPromise(effect)); } catch (error) { setError(message(error)); } finally { setBusy(false); }
  };
  const folder = (event: FormEvent) => { event.preventDefault(); if (selected) void run(Api.organize({ operation: 'create-folder', key: selected.index, name: folderName.trim(), address: selected.address })); };
  const zone = (event: FormEvent) => {
    event.preventDefault();
    try { void run(Api.organize({ operation: 'create-zone', name: zoneName.trim(), keys: numbers(zoneKeys), revision: snapshot.layout.revision })); }
    catch (error) { setError(message(error)); }
  };
  return h('section', { className: 'layout-controls', 'aria-label': 'Dossiers, zones et pages' },
    h('div', { className: 'zone-navigation' }, ...snapshot.layout.zones.map((zone) => h('div', { key: zone.id, className: 'zone-navigation-row' },
      h('div', { className: 'zone-path' }, h('button', { disabled, onClick: () => void run(Api.navigate({ zone: zone.id, operation: 'root' })), title: 'Revenir à la racine de cette zone' }, zone.name),
        ...zone.breadcrumbs.map((crumb, index) => h('span', { key: `${crumb.id}/${index}` }, h('span', { 'aria-hidden': true }, ' / '), crumb.name)),
        h('small', { className: 'zone-range' }, `Touches ${keyRanges(zone.keys)}`)),
      h('div', { className: 'zone-page-actions' }, zone.folder ? h('button', { disabled, onClick: () => void run(Api.navigate({ zone: zone.id, operation: 'back' })), 'aria-label': `Retour dans ${zone.name}` }, 'Retour') : null,
        h('button', { disabled: disabled || zone.pages < 2, 'aria-label': `Page précédente · ${zone.name}`, onClick: () => void run(Api.navigate({ zone: zone.id, operation: 'previous' })) }, h(Arrow, { previous: true })),
        h('span', { className: 'page-number', 'aria-label': `Page de ${zone.name}` }, `${zone.page + 1} / ${zone.pages}`),
        h('button', { disabled: disabled || zone.pages < 2, 'aria-label': `Page suivante · ${zone.name}`, onClick: () => void run(Api.navigate({ zone: zone.id, operation: 'next' })) }, h(Arrow)),
        h('button', { disabled, onClick: () => void run(Api.organize({ operation: 'add-page', zone: zone.id, revision: snapshot.layout.revision })), 'aria-label': `Ajouter une page · ${zone.name}` }, 'Ajouter une page')),
    ))),
    h('details', { className: 'organization-details' }, h('summary', {}, 'Organiser les dossiers et les zones'),
      h('div', { className: 'organization-forms' },
        h('form', { onSubmit: folder }, h('h3', {}, 'Nouveau dossier'),
          h('p', { className: 'field-hint' }, selected && !selected.binding ? `Il sera placé sur la touche ${selected.index + 1}.` : 'Sélectionne une touche libre dans l’aperçu.'),
          h('label', { className: 'field' }, h('span', {}, 'Nom du nouveau dossier'), h('input', { required: true, maxLength: 80, value: folderName, disabled, onChange: (event) => setFolderName((event.currentTarget as HTMLInputElement).value) })),
          h('button', { type: 'submit', disabled: disabled || !selected || !!selected.binding || !folderName.trim() }, 'Créer le dossier')),
        h('form', { onSubmit: zone }, h('h3', {}, 'Nouvelle zone de touches'),
          h('p', { className: 'field-hint' }, 'Ces touches quittent la zone principale. Leurs raccourcis sont conservés.'),
          h('label', { className: 'field' }, h('span', {}, 'Nom de la zone'), h('input', { required: true, maxLength: 80, value: zoneName, disabled, onChange: (event) => setZoneName((event.currentTarget as HTMLInputElement).value) })),
          h('label', { className: 'field' }, h('span', {}, 'Touches de la zone'), h('input', { 'aria-label': 'Touches de la zone', 'aria-describedby': 'zone-keys-hint', required: true, placeholder: '1-9, 19-27', value: zoneKeys, disabled, onChange: (event) => setZoneKeys((event.currentTarget as HTMLInputElement).value) }), h('small', { id: 'zone-keys-hint' }, 'Numéros visibles sur le deck, séparés par des virgules ou des plages.')),
          h('button', { type: 'submit', disabled: disabled || !zoneName.trim() || !zoneKeys.trim() }, 'Créer la zone')),
        snapshot.layout.folders.length ? h('form', { onSubmit: (event) => { event.preventDefault(); void run(Api.organize({ operation: 'rename-folder', id: renameId, name: rename.trim(), revision: snapshot.layout.revision })); } },
          h('h3', {}, 'Renommer un dossier'),
          h('label', { className: 'field' }, h('span', {}, 'Dossier à renommer'), h('select', { value: renameId, disabled, required: true, onChange: (event) => { const id = (event.currentTarget as HTMLSelectElement).value; setRenameId(id); setRename(snapshot.layout.folders.find((folder) => folder.id === id)?.name ?? ''); } },
            h('option', { value: '' }, 'Choisir un dossier'), ...snapshot.layout.folders.map((folder) => h('option', { key: folder.id, value: folder.id }, folder.name)))),
          h('label', { className: 'field' }, h('span', {}, 'Nouveau nom du dossier'), h('input', { required: true, maxLength: 80, disabled, value: rename, onChange: (event) => setRename((event.currentTarget as HTMLInputElement).value) })),
          h('button', { type: 'submit', disabled: disabled || !renameId || !rename.trim() }, 'Renommer')) : null,
      )),
    error ? h('p', { className: 'error', role: 'alert' }, error) : null,
    dirty ? h('p', { className: 'field-hint' }, 'Enregistre ou annule l’affectation avant de changer la disposition.') : null,
  );
}

export function ShortcutOrganization({ snapshot, selected, online, dirty, onSnapshot }: Props) {
  const [destination, setDestination] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  if (!selected?.id || selected.navigation) return null;
  const disabled = busy || dirty || !online;
  const run = async (effect: Effect.Effect<Snapshot, unknown>) => {
    setBusy(true); setError(''); try { onSnapshot(await Effect.runPromise(effect)); } catch (error) { setError(message(error)); } finally { setBusy(false); }
  };
  return h('div', { className: 'shortcut-organization' }, h('h3', {}, 'Rangement'),
    h('label', { className: 'pin-field' }, h('input', { type: 'checkbox', checked: selected.pinned, disabled, onChange: (event) => void run(Api.organize({ operation: 'pin', key: selected.index, value: (event.currentTarget as HTMLInputElement).checked, address: selected.address })) }),
      h('span', {}, 'Fixer sur toutes les pages et dossiers de cette zone')),
    h('form', { onSubmit: (event) => { event.preventDefault(); void run(Api.organize({ operation: 'move', id: selected.id!, destination, revision: snapshot.layout.revision })); } },
      h('label', { className: 'field' }, h('span', {}, 'Déplacer vers'), h('select', { value: destination, required: true, disabled, onChange: (event) => setDestination((event.currentTarget as HTMLSelectElement).value) },
        h('option', { value: '' }, 'Choisir une destination'),
        h('optgroup', { label: 'Zones' }, ...snapshot.layout.zones.map((zone) => h('option', { key: zone.id, value: `zone:${zone.id}` }, zone.name))),
        h('optgroup', { label: 'Dossiers' }, ...snapshot.layout.folders.map((folder) => h('option', { key: folder.id, value: `folder:${folder.id}` }, folder.name))))),
      h('button', { type: 'submit', disabled: disabled || !destination }, 'Déplacer le raccourci')),
    error ? h('p', { className: 'error', role: 'alert' }, error) : null,
  );
}
