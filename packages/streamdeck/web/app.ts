import { createElement as h, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { Effect, Fiber, Schedule } from 'effect';
import type { ActionId, ButtonBinding, Catalogue, Snapshot } from '../src/studio-contract.ts';
import { KeyCard } from '../src/ui/key-card.ts';
import * as Api from './api.ts';
import { LayoutControls, ShortcutOrganization } from './layout-controls.ts';
import { TargetPreview, zoneLabel } from './zone-map.ts';
import { PluginControls } from './plugin-controls.ts';
import './style.css';

function Icon({ name, size = 20 }: { name: 'plus' | 'left' | 'right' | 'play' | 'save' | 'deck'; size?: number }) {
  const paths = { plus: 'M12 5v14M5 12h14', left: 'm14 6-6 6 6 6', right: 'm10 6 6 6-6 6', play: 'm8 5 11 7-11 7Z', save: 'M5 3h12l4 4v14H3V3h2Zm2 0v6h10V3M7 21v-8h10v8', deck: 'M3 4h18v16H3ZM7 8h2m3 0h2m3 0h1M7 12h2m3 0h2m3 0h1M7 16h11' };
  return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: paths[name] }));
}
type KeyView = Snapshot['keys'][number];
type Selection = { kind: 'key' | 'dial'; index: number };
type Draft = { action: ActionId | ''; label: string; values: Record<string, string> };
const draftOf = (binding: ButtonBinding | null): Draft => ({ action: binding?.action ?? '', label: binding?.label ?? '', values: Object.fromEntries(Object.entries(binding?.action === 'open-folder' ? { ...binding.parameters, target: binding.parameters.target ?? 'current' } : binding?.parameters ?? {}).map(([key, value]) => [key, Array.isArray(value) ? value.join('\n') : String(value)])) });
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'La requête a échoué.';

function KeyInspector({ selected, catalogue, snapshot, online, onSnapshot, onDirty }: {
  selected: KeyView; catalogue: Catalogue; snapshot: Snapshot; online: boolean; onSnapshot: (snapshot: Snapshot) => void; onDirty: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(selected.binding));
  const [saved, setSaved] = useState(() => JSON.stringify(draftOf(selected.binding)));
  const [baseline, setBaseline] = useState(selected.binding);
  const [baselineAddress, setBaselineAddress] = useState(selected.address);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const dirty = JSON.stringify(draft) !== saved;
  const definition = catalogue.actions.find((action) => action.id === draft.action);
  useEffect(() => { onDirty(dirty || busy); }, [dirty, busy]);
  useEffect(() => {
    if (!dirty && !busy) { const next = draftOf(selected.binding); setDraft(next); setSaved(JSON.stringify(next)); setBaseline(selected.binding); setBaselineAddress(selected.address); }
  }, [JSON.stringify(selected.binding), selected.address]);
  const parameters = Object.fromEntries((definition?.fields ?? []).map((field) => [field.key, field.kind === 'number' ? Number(draft.values[field.key] ?? 0) : field.kind === 'arguments' ? draft.values[field.key] ? draft.values[field.key]!.split('\n') : [] : draft.values[field.key] ?? '']));
  const binding = draft.action ? { action: draft.action, label: draft.label || definition!.name, parameters } : null;
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const snapshot = await Effect.runPromise(Api.save(selected.index, binding, baseline, baselineAddress));
      const next = draftOf(snapshot.keys.find((key) => key.index === selected.index)!.binding);
      setDraft(next); setSaved(JSON.stringify(next)); setBaseline(snapshot.keys.find((key) => key.index === selected.index)!.binding); setBaselineAddress(snapshot.keys.find((key) => key.index === selected.index)!.address); onSnapshot(snapshot); setNotice('Affectation enregistrée.');
    } catch (error) { setError(messageOf(error)); } finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true); setError(''); setNotice('');
    try { onSnapshot(await Effect.runPromise(selected.status === 'running' ? Api.cancel(selected.index, selected.address) : Api.trigger(selected.index, selected.address))); setNotice(selected.status === 'running' ? 'Commande arrêtée.' : 'Action déclenchée.'); }
    catch (error) { setError(messageOf(error)); } finally { setBusy(false); }
  };
  if (selected.navigation) return h('section', { className: 'inspector' }, h('h2', {}, 'Retour du dossier'), h('p', { className: 'inspector-intro' }, 'Cette touche reste disponible sur toutes les pages du dossier pour revenir à son parent.'), h('button', { disabled: busy || !online, onClick: test }, 'Revenir'));
  return h('section', { className: 'inspector', 'aria-labelledby': 'inspector-title' },
    h('div', { className: 'inspector-heading' }, h('h2', { id: 'inspector-title' }, `Touche ${selected.index + 1}`), h('span', { className: 'coordinate' }, `${selected.row + 1} : ${selected.column + 1}`)),
    h('p', { className: 'inspector-intro' }, 'Choisis ce que fait cette touche.'),
    h('form', { onSubmit: submit },
      h('label', { className: 'field' }, h('span', {}, 'Action'), h('select', { value: draft.action, disabled: busy, onChange: (event) => {
        const id = (event.currentTarget as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value as ActionId | ''; const action = catalogue.actions.find((action) => action.id === id);
        setDraft({ action: id, label: action?.name ?? '', values: Object.fromEntries(Object.entries(action?.defaults ?? {}).map(([key, value]) => [key, Array.isArray(value) ? value.join('\n') : String(value)])) }); setError(''); setNotice('');
      } }, h('option', { value: '' }, 'Aucune action'), ...catalogue.actions.map((action) => h('option', { key: action.id, value: action.id }, action.name)))),
      definition ? h('p', { className: 'action-description' }, definition.description) : h('p', { className: 'action-description' }, 'Une touche libre ne déclenche rien.'),
      definition ? h('label', { className: 'field' }, h('span', {}, 'Nom sur la touche'), h('input', { value: draft.label, maxLength: 80, disabled: busy, onChange: (event) => setDraft({ ...draft, label: (event.currentTarget as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value }) })) : null,
      ...(definition?.fields ?? []).map((field) => h('label', { key: field.key, className: 'field' }, h('span', {}, field.label),
        field.kind === 'folder' || field.kind === 'zone' ? h('select', { 'aria-label': field.label, value: draft.values[field.key] ?? '', required: true, disabled: busy, onChange: (event) => setDraft({ ...draft, values: { ...draft.values, [field.key]: (event.currentTarget as HTMLSelectElement).value } }) },
          h('option', { value: '' }, field.kind === 'folder' ? 'Choisir un dossier' : 'Choisir une zone'),
          ...(field.kind === 'folder' ? snapshot.layout.folders.map((folder) => h('option', { key: folder.id, value: folder.id }, folder.name)) : [h('option', { key: 'current', value: 'current' }, `Zone de cette touche · ${snapshot.layout.zones.find((zone) => zone.id === selected.zone)?.name}`), ...(draft.action === 'open-folder' ? [] : [h('option', { key: 'audio', value: 'audio' }, 'Mixer audio LCD')]), ...snapshot.layout.zones.map((zone) => h('option', { key: zone.id, value: zone.id }, zoneLabel(zone)))]))
        : field.kind === 'app' ? h('select', { 'aria-label': field.label, required: true, value: draft.values[field.key] ?? '', disabled: busy, onChange: (event) => {
          const app = catalogue.applications.find((app) => app.id === (event.currentTarget as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value);
          setDraft({ ...draft, label: draft.label === definition?.name ? app?.name ?? draft.label : draft.label, values: { ...draft.values, [field.key]: (event.currentTarget as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value } });
        } }, h('option', { value: '' }, 'Choisir une application'), ...catalogue.applications.map((app) => h('option', { key: app.id, value: app.id }, app.name)))
          : field.kind === 'arguments' ? h('textarea', { 'aria-label': field.label, 'aria-describedby': field.hint ? `hint-${field.key}` : undefined, rows: 4, className: 'code-input', value: draft.values[field.key] ?? '', disabled: busy, onChange: (event) => setDraft({ ...draft, values: { ...draft.values, [field.key]: (event.currentTarget as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value } }) })
            : h('input', { 'aria-label': field.label, 'aria-describedby': field.hint ? `hint-${field.key}` : undefined, type: field.kind === 'number' ? 'number' : 'text', required: field.key === 'executable', min: field.kind === 'number' ? -9999 : undefined, max: field.kind === 'number' ? 9999 : undefined, className: field.key === 'executable' || field.key === 'directory' ? 'code-input' : '', value: draft.values[field.key] ?? '', disabled: busy, onChange: (event) => setDraft({ ...draft, values: { ...draft.values, [field.key]: (event.currentTarget as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value } }) }),
        field.hint ? h('small', { id: `hint-${field.key}` }, field.hint) : null)),
      draft.action === 'open-folder' || draft.action === 'page-next' || draft.action === 'page-previous' ? h(TargetPreview, { snapshot, zoneId: !draft.values.target || draft.values.target === 'current' ? selected.zone : draft.values.target, folder: draft.action === 'open-folder' }) : null,
      definition ? h('div', { className: 'draft-preview' }, h(KeyCard, { width: 112, height: 112, label: draft.label || definition.name, action: definition.id, count: draft.action === 'counter' ? Number(draft.values.start ?? 0) : 0, status: 'idle' }), h('span', {}, 'Aperçu de l’affectation')) : null,
      h('div', { className: 'form-actions' }, h('button', { type: 'submit', className: 'primary', disabled: !dirty || busy || !online || selected.status === 'running' || baselineAddress !== selected.address }, h(Icon, { name: 'save', size: 17 }), busy ? 'En cours…' : 'Enregistrer'),
        h('button', { type: 'button', disabled: !dirty || busy, onClick: () => { setDraft(draftOf(selected.binding)); setSaved(JSON.stringify(draftOf(selected.binding))); setBaseline(selected.binding); setBaselineAddress(selected.address); setError(''); setNotice(''); } }, 'Annuler')),
      h('p', { className: 'save-state', role: 'status' }, dirty ? 'Modifications non enregistrées' : notice || 'Affectation à jour'),
      dirty && baselineAddress !== selected.address ? h('p', { className: 'error', role: 'alert' }, 'La touche a changé de page. Annule pour charger son contenu actuel.') : null,
      error ? h('p', { className: 'error', role: 'alert' }, error) : null,
    ),
    h('div', { className: 'test-action' }, h('button', { className: 'test-button', disabled: !selected.binding || dirty || busy || !online, onClick: test }, h(Icon, { name: 'play', size: 17 }), selected.status === 'running' ? 'Arrêter la commande' : selected.binding?.action === 'open-folder' ? 'Ouvrir le dossier' : 'Tester l’action'),
      h('p', {}, 'Exécute l’action enregistrée, comme un appui sur la touche.')),
    h(ShortcutOrganization, { key: selected.id, snapshot, selected, online, dirty: dirty || busy, onSnapshot }),
    selected.detail ? h('div', { className: 'command-result' }, h('h3', {}, selected.status === 'error' ? 'Échec de l’action' : selected.status === 'running' ? 'Sortie en cours' : 'Dernière sortie'), h('pre', { className: selected.status === 'error' ? 'error-output' : '' }, selected.detail)) : null,
  );
}

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>(); const [catalogue, setCatalogue] = useState<Catalogue>();
  const [online, setOnline] = useState(false); const [error, setError] = useState('');
  const [selection, setSelection] = useState<Selection>({ kind: 'key', index: 0 }); const [dirty, setDirty] = useState(false);
  const acceptSnapshot = (value: Snapshot) => setSnapshot((previous) => previous?.sessionId === value.sessionId && (previous.inputSequence > value.inputSequence || previous.plugins.revision > value.plugins.revision || (previous.plugins.revision === value.plugins.revision && previous.layout.revision > value.layout.revision)) ? previous : value);
  useEffect(() => {
    const watcher = Effect.runFork(Api.observe((value) => { acceptSnapshot(value); setOnline(true); }, () => setOnline(false)));
    const loader = Effect.runFork(Api.catalogue.pipe(Effect.retry(Schedule.spaced(1000)), Effect.match({ onSuccess: setCatalogue, onFailure: (error) => setError(messageOf(error)) })));
    return () => { Effect.runFork(Fiber.interrupt(watcher)); Effect.runFork(Fiber.interrupt(loader)); };
  }, []);
  const select = (next: Selection) => {
    if (selection.kind === next.kind && selection.index === next.index) return;
    if (dirty && !window.confirm('Abandonner les modifications non enregistrées ?')) return;
    setDirty(false); setSelection(next);
  };
  const selectedKey = snapshot?.keys.find((key) => selection.kind === 'key' && key.index === selection.index);
  const selectedDial = snapshot?.dials.find((dial) => selection.kind === 'dial' && dial.index === selection.index);
  const shortcutsActive = snapshot?.plugins.items.find((plugin) => plugin.id === 'shortcuts')?.enabled ?? false;
  const mixerActive = snapshot?.plugins.items.find((plugin) => plugin.id === 'audio-mixer')?.enabled ?? false;
  const columns = snapshot ? Math.max(...snapshot.keys.map((key) => key.column)) + 1 : 9;
  const turnPage = (direction: number) => { Effect.runFork(Api.page(direction).pipe(Effect.match({ onSuccess: acceptSnapshot, onFailure: (error) => setError(messageOf(error)) }))); };
  return h('div', { className: 'app-shell' },
    h('header', { className: 'topbar' }, h('div', { className: 'brand' }, h(Icon, { name: 'deck', size: 27 }), h('h1', {}, 'Stream Deck')),
      h('div', { className: 'connection', role: 'status' }, h('span', { className: online ? 'status-dot online' : 'status-dot' }), online ? snapshot?.mock ? 'Deck simulé' : 'Connecté' : snapshot ? 'Reconnexion…' : 'Connexion…')),
    h('main', { className: 'workspace' },
      h('section', { className: 'preview-panel', 'aria-label': 'Aperçu du deck' },
        h('div', { className: 'preview-heading' }, h('div', {}, h('h2', {}, snapshot?.model.replace(/^Mock /, '') ?? 'Ton deck'), h('p', {}, 'Sélectionne une touche pour la configurer. Double-clique sur une touche de navigation pour l’utiliser.')),
          h('span', { className: 'profile-name' }, 'Profil principal')),
        h('div', { className: 'device', style: { '--columns': columns } as import('react').CSSProperties },
          h('div', { className: snapshot ? 'key-grid' : 'key-grid loading', 'aria-label': 'Touches' }, ...(snapshot?.keys ?? Array.from({ length: 36 }, (_, index) => ({ index, binding: null, revision: 0, pressed: false }))).map((key) => h('button', {
            key: key.index, className: `deck-key${selection.kind === 'key' && selection.index === key.index ? ' selected' : ''}${key.pressed ? ' pressed' : ''}`,
            'aria-label': `Touche ${key.index + 1}${key.binding ? ` · ${key.binding.label}` : ` · ${snapshot?.plugins.items.find((plugin) => plugin.enabled && plugin.keys.includes(key.index))?.name ?? 'libre'}`}`, 'aria-pressed': selection.kind === 'key' && selection.index === key.index,
            disabled: !snapshot, onClick: () => select({ kind: 'key', index: key.index }),
            onDoubleClick: () => {
              const current = snapshot?.keys.find((item) => item.index === key.index);
              if (current?.binding && ['open-folder', 'go-back', 'page-next', 'page-previous'].includes(current.binding.action) && !dirty && online) Effect.runFork(Api.trigger(current.index, current.address).pipe(Effect.match({ onSuccess: acceptSnapshot, onFailure: (error) => setError(messageOf(error)) })));
            },
          }, key.revision ? h('img', { src: `/api/image/key/${key.index}?session=${snapshot?.sessionId}&revision=${key.revision}`, alt: '', draggable: false }) : h('span', { className: 'empty-key' }, h(Icon, { name: 'plus', size: 22 })), h('span', { className: 'key-number' }, key.index + 1)))),
          ...(snapshot?.lcds ?? [{ index: 0, revision: 0, width: 1200, height: 100 }]).map((lcd) => h('div', { key: lcd.index, className: 'lcd-strip', style: { aspectRatio: `${lcd.width}/${lcd.height}` }, 'aria-label': 'Écran LCD du mixer audio' }, lcd.revision ? h('img', { src: `/api/image/lcd/${lcd.index}?session=${snapshot?.sessionId}&revision=${lcd.revision}`, alt: 'Affichage actuel des volumes et du Master', draggable: false }) : null)),
          h('div', { className: 'dial-row' }, ...(snapshot?.dials ?? Array.from({ length: 6 }, (_, index) => ({ index, master: index === 5, name: null, pressed: false, x: index * 200, width: 200 }))).map((dial) => h('button', {
            key: dial.index, className: `dial-control${selection.kind === 'dial' && selection.index === dial.index ? ' selected' : ''}${dial.pressed ? ' pressed' : ''}`,
            style: { width: `${dial.width / (snapshot?.lcds[0]?.width ?? 1200) * 100}%` },
            'aria-label': `Potard ${dial.index + 1} · ${dial.name ?? 'aucune application'}`, disabled: !snapshot, onClick: () => select({ kind: 'dial', index: dial.index }),
          }, h('svg', { viewBox: '0 0 64 64', className: 'knob', 'aria-hidden': true }, h('circle', { cx: 32, cy: 32, r: 27, fill: '#2C2E35', stroke: '#555863', strokeWidth: 2 }),
            ...Array.from({ length: 24 }, (_, i) => h('path', { key: i, d: 'M32 5v4', stroke: '#6A6D78', strokeWidth: 1, transform: `rotate(${i * 15} 32 32)` })),
            h('circle', { cx: 32, cy: 32, r: 20, fill: '#363942' }), h('path', { d: 'M32 14v8', stroke: '#D8D9DF', strokeWidth: 2, strokeLinecap: 'round' })),
            h('span', {}, dial.master ? 'Master' : `Potard ${dial.index + 1}`)))),
        ),
        h('div', { className: 'preview-footer' }, h('span', {}, online ? 'Aperçu en direct' : 'Reconnexion au moteur…'),
          h('div', { className: 'pagination' }, h('button', { 'aria-label': 'Applications précédentes', disabled: !online || (snapshot?.pages ?? 1) < 2, onClick: () => turnPage(-1) }, h(Icon, { name: 'left', size: 17 })), h('span', {}, `${(snapshot?.page ?? 0) + 1} / ${snapshot?.pages ?? 1}`), h('button', { 'aria-label': 'Applications suivantes', disabled: !online || (snapshot?.pages ?? 1) < 2, onClick: () => turnPage(1) }, h(Icon, { name: 'right', size: 17 })))),
        snapshot ? h(PluginControls, { snapshot, online, dirty, onSnapshot: acceptSnapshot }) : null,
        snapshot ? h(LayoutControls, { snapshot, selected: selectedKey, online: online && shortcutsActive, dirty, onSnapshot: acceptSnapshot }) : null,
        h('p', { className: 'preview-note' }, 'Les touches libres restent sans affectation. Leur ancienne image physique n’est pas disponible.'),
        error ? h('p', { className: 'error', role: 'alert' }, error) : null,
      ),
      selectedKey && !shortcutsActive ? h('section', { className: 'inspector' }, h('h2', {}, `Touche ${selectedKey.index + 1}`), h('p', { className: 'inspector-intro' }, snapshot?.plugins.items.some((plugin) => plugin.enabled && plugin.keys.includes(selectedKey.index)) ? `Cette touche est pilotée par ${snapshot.plugins.items.find((plugin) => plugin.enabled && plugin.keys.includes(selectedKey.index))!.name}. Désactive ce plugin avant de lui affecter un raccourci.` : 'Le plugin Raccourcis est désactivé. Active-le dans Fonctionnalités pour configurer et utiliser les touches.'))
        : selectedDial && !mixerActive ? h('section', { className: 'inspector' }, h('h2', {}, `Potard ${selectedDial.index + 1}`), h('p', { className: 'inspector-intro' }, 'Le mixer audio est désactivé. Ce potard est disponible pour un autre plugin.'))
        : selectedKey && catalogue ? h(KeyInspector, { key: selectedKey.index, selected: selectedKey, catalogue, snapshot: snapshot!, online, onSnapshot: acceptSnapshot, onDirty: setDirty })
        : selectedDial ? h('section', { className: 'inspector dial-inspector' }, h('h2', {}, selectedDial.master ? 'Master' : `Potard ${selectedDial.index + 1}`), h('p', { className: 'inspector-intro' }, 'Mixer audio'),
          h('div', { className: 'dial-assignment' }, h('h3', {}, selectedDial.name ?? 'Aucune application'), h('p', {}, selectedDial.volume === null ? 'Ce potard est libre sur cette page.' : `${Math.round(selectedDial.volume)} %${selectedDial.muted ? ' · Son coupé' : ''}`)),
          h('dl', { className: 'behaviors' }, h('dt', {}, 'Rotation'), h('dd', {}, 'Volume de la source affichée'), h('dt', {}, 'Appui'), h('dd', {}, 'Couper ou rétablir le son')),
          h('p', { className: 'action-description' }, selectedDial.master ? 'Master reste fixe sur toutes les pages.' : 'Un glissement sur le LCD parcourt les applications. Le potard suit la source affichée.'))
          : h('section', { className: 'inspector skeleton', 'aria-label': 'Chargement de l’inspecteur' }, h('div', {}), h('div', {}), h('div', {})),
    ),
  );
}
createRoot(document.getElementById('root')!).render(h(App));
