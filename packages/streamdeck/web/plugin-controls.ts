import { createElement as h, useState } from 'react';
import { Effect } from 'effect';
import type { Snapshot } from '../src/studio-contract.ts';
import { keyRanges } from './zone-map.ts';
import * as Api from './api.ts';

export function PluginControls({ snapshot, online, dirty, onSnapshot }: { snapshot: Snapshot; online: boolean; dirty: boolean; onSnapshot: (snapshot: Snapshot) => void }) {
  const [busy, setBusy] = useState<string | null>(null); const [error, setError] = useState('');
  const toggle = async (plugin: Snapshot['plugins']['items'][number], enabled: boolean) => {
    setBusy(plugin.id); setError('');
    try { onSnapshot(await Effect.runPromise(Api.setPlugin(plugin.id, enabled, plugin.enabled))); }
    catch (error) { setError(error instanceof Error ? error.message : 'Le plugin n’a pas pu être modifié.'); }
    finally { setBusy(null); }
  };
  return h('section', { className: 'plugin-controls', 'aria-label': 'Fonctionnalités' }, h('h3', {}, 'Fonctionnalités'),
    ...snapshot.plugins.items.map((plugin) => h('div', { key: plugin.id },
      h('label', { className: 'plugin-row' }, h('input', { type: 'checkbox', 'aria-label': `Activer ${plugin.name}`, checked: plugin.enabled, disabled: !online || !!busy || dirty || plugin.phase === 'unsupported', onChange: (event) => void toggle(plugin, (event.currentTarget as HTMLInputElement).checked) }),
        h('span', {}, h('strong', {}, plugin.name), h('span', { className: `plugin-phase ${plugin.phase}`, role: 'status' }, busy === plugin.id ? 'En cours…' : plugin.phase === 'enabled' ? 'Actif' : plugin.phase === 'error' ? 'Erreur' : plugin.phase === 'unsupported' ? 'Indisponible' : 'Désactivé'),
          h('small', {}, plugin.description), h('small', {}, [plugin.keys.length ? `Touches ${keyRanges(plugin.keys)}` : '', plugin.dials.length ? `Potards ${keyRanges(plugin.dials)}` : '', plugin.lcds.length ? 'Écran LCD' : ''].filter(Boolean).join(' · ') || 'Aucun contrôle réservé'))),
      plugin.detail ? h('p', { className: plugin.phase === 'error' ? 'error' : 'field-hint' }, plugin.detail) : null)),
    dirty ? h('p', { className: 'field-hint' }, 'Enregistre ou annule l’affectation avant de changer les fonctionnalités.') : null,
    error ? h('p', { className: 'error', role: 'alert' }, error) : null,
  );
}
