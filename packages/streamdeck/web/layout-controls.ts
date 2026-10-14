import { createElement as h, useState, type FormEvent } from 'react';
import { Effect } from 'effect';
import type { Snapshot } from '../src/studio-contract.ts';
import * as Api from './api.ts';
import { keyRanges, zoneLabel, ZoneMap, TargetPreview } from './zone-map.ts';

type KeyView = Snapshot['keys'][number];
type Props = { snapshot: Snapshot; selected: KeyView | undefined; online: boolean; dirty: boolean; onSnapshot: (snapshot: Snapshot) => void };
const message = (error: unknown) => error instanceof Error ? error.message : 'La disposition n’a pas pu être modifiée.';
const Arrow = ({ previous = false }: { previous?: boolean }) => h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true }, h('path', { d: previous ? 'm14 5-7 7 7 7' : 'm10 5 7 7-7 7' }));
function ZoneEditor({ snapshot, id, disabled, run, close }: { snapshot: Snapshot; id: string; disabled: boolean; run: (effect: Effect.Effect<Snapshot, unknown>) => Promise<void>; close: () => void }) {
  const existing = snapshot.layout.zones.find((zone) => zone.id === id);
  const [name, setName] = useState(''); const [keys, setKeys] = useState<number[]>([...(existing?.keys ?? [])]);
  const allowed = snapshot.keys.filter((key) => !key.pinned && (key.zone === 'deck' || key.zone === id)).map((key) => key.index);
  const fixed = snapshot.keys.filter((key) => keys.includes(key.index) && key.pinned).length;
  return h('form', { className: 'zone-editor', onSubmit: (event) => { event.preventDefault(); void run(Api.organize(existing ? { operation: 'resize-zone', zone: id, keys, revision: snapshot.layout.revision } : { operation: 'create-zone', name: name.trim(), keys, revision: snapshot.layout.revision })); } },
    h('h3', {}, existing ? `Touches de ${existing.name}` : 'Créer une zone'),
    existing ? null : h('label', { className: 'field' }, h('span', {}, 'Nom de la zone'), h('input', { value: name, required: true, maxLength: 80, disabled, onChange: (event) => setName((event.currentTarget as HTMLInputElement).value) })),
    h('p', { className: 'field-hint' }, 'Clique sur les touches à inclure. Les touches fixes restent en place ; les touches d’autres zones sont indisponibles.'),
    h(ZoneMap, { snapshot, keys, allowed, disabled, onToggle: (key) => setKeys((before) => before.includes(key) ? before.filter((item) => item !== key) : [...before, key]) }),
    h('p', { className: 'zone-capacity', 'aria-live': 'polite' }, keys.length ? `Touches ${keyRanges(keys)} · ${keys.length - fixed} icônes par page, ou ${Math.max(0, keys.length - fixed - 1)} + Retour pour un dossier.` : 'Sélectionne au moins une touche.'),
    h('p', { className: 'field-hint' }, 'Les raccourcis suivent leurs touches sur toutes les pages. Les touches retirées reviennent à la zone principale. Après enregistrement, les zones concernées reviennent à leur première page.'),
    h('div', { className: 'form-actions' }, h('button', { type: 'submit', className: 'primary', disabled: disabled || !keys.length || (!existing && !name.trim()) }, existing ? 'Enregistrer la zone' : 'Créer la zone'),
      h('button', { type: 'button', onClick: close }, 'Fermer')),
  );
}

export function LayoutControls({ snapshot, selected, online, dirty, onSnapshot }: Props) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [folderName, setFolderName] = useState(''); const [folderTarget, setFolderTarget] = useState('current'); const [editing, setEditing] = useState<string | null>(null);
  const [renameId, setRenameId] = useState(''); const [rename, setRename] = useState('');
  const disabled = busy || dirty || !online;
  const run = async (effect: Effect.Effect<Snapshot, unknown>) => {
    setBusy(true); setError('');
    try { onSnapshot(await Effect.runPromise(effect)); } catch (error) { setError(message(error)); } finally { setBusy(false); }
  };
  const folder = (event: FormEvent) => { event.preventDefault(); if (selected) void run(Api.organize({ operation: 'create-folder', key: selected.index, name: folderName.trim(), address: selected.address, target: folderTarget })); };
  return h('section', { className: 'layout-controls', id: 'zones', 'aria-label': 'Dossiers, zones et pages' },
    h('div', { className: 'zone-navigation' }, ...snapshot.layout.zones.map((zone) => h('div', { key: zone.id, className: 'zone-navigation-row' },
      h('div', { className: 'zone-path' }, h('button', { disabled, onClick: () => void run(Api.navigate({ zone: zone.id, operation: 'root' })), title: 'Revenir à la racine de cette zone' }, zone.name),
        ...zone.breadcrumbs.map((crumb, index) => h('span', { key: `${crumb.id}/${index}` }, h('span', { 'aria-hidden': true }, ' / '), crumb.name)),
        h('small', { className: 'zone-range' }, `Touches ${keyRanges(zone.keys)}`), h('button', { className: 'zone-edit-link', disabled, onClick: () => setEditing(zone.id === 'deck' ? 'new' : zone.id) }, zone.id === 'deck' ? 'Créer une zone' : 'Modifier les touches')),
      h('div', { className: 'zone-page-actions' }, zone.folder ? h('button', { disabled, onClick: () => void run(Api.navigate({ zone: zone.id, operation: 'back' })), 'aria-label': `Retour dans ${zone.name}` }, 'Retour') : null,
        h('button', { disabled: disabled || zone.pages < 2, 'aria-label': `Page précédente · ${zone.name}`, onClick: () => void run(Api.navigate({ zone: zone.id, operation: 'previous' })) }, h(Arrow, { previous: true })),
        h('span', { className: 'page-number', 'aria-label': `Page de ${zone.name}` }, `${zone.page + 1} / ${zone.pages}`),
        h('button', { disabled: disabled || zone.pages < 2, 'aria-label': `Page suivante · ${zone.name}`, onClick: () => void run(Api.navigate({ zone: zone.id, operation: 'next' })) }, h(Arrow)),
        h('button', { disabled, onClick: () => void run(Api.organize({ operation: 'add-page', zone: zone.id, revision: snapshot.layout.revision })), 'aria-label': `Ajouter une page · ${zone.name}` }, 'Ajouter une page')),
    ))),
    editing ? h(ZoneEditor, { key: editing, snapshot, id: editing, disabled, run, close: () => setEditing(null) }) : null,
    h('details', { className: 'organization-details' }, h('summary', {}, 'Organiser les dossiers et les zones'),
      h('div', { className: 'organization-forms' },
        h('form', { onSubmit: folder }, h('h3', {}, 'Nouveau dossier'),
          h('p', { className: 'field-hint' }, selected && !selected.binding ? `Il sera placé sur la touche ${selected.index + 1}.` : 'Sélectionne une touche libre dans l’aperçu.'),
          h('label', { className: 'field' }, h('span', {}, 'Nom du nouveau dossier'), h('input', { required: true, maxLength: 80, value: folderName, disabled, onChange: (event) => setFolderName((event.currentTarget as HTMLInputElement).value) })),
          h('label', { className: 'field' }, h('span', {}, 'Zone du nouveau dossier'), h('select', { value: folderTarget, disabled, onChange: (event) => setFolderTarget((event.currentTarget as HTMLSelectElement).value) },
            h('option', { value: 'current' }, 'Zone de la touche sélectionnée'), ...snapshot.layout.zones.map((zone) => h('option', { key: zone.id, value: zone.id }, zoneLabel(zone))))),
          selected ? h(TargetPreview, { snapshot, zoneId: folderTarget === 'current' ? selected.zone : folderTarget, folder: true }) : null,
          h('button', { type: 'submit', disabled: disabled || !selected || !!selected.binding || !folderName.trim() }, 'Créer le dossier')),
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
