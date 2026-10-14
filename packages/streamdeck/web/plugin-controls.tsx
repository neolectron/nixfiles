import { useState } from 'react';
import type { Snapshot } from '../src/studio-contract.ts';
import { keyRanges } from './zone-map.tsx';
import * as Api from './api.ts';
import { DiscordConnection } from './discord-connection.tsx';
export function PluginControls({
  snapshot,
  online,
  dirty,
  onSnapshot,
}: {
  snapshot: Snapshot;
  online: boolean;
  dirty: boolean;
  onSnapshot: (snapshot: Snapshot) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const toggle = async (plugin: Snapshot['plugins']['items'][number], enabled: boolean) => {
    setBusy(plugin.id);
    setError('');
    try {
      onSnapshot(await Api.run(Api.setPlugin(plugin.id, enabled, plugin.enabled)));
    } catch (currentError) {
      setError(
        currentError instanceof Error ? currentError.message : 'Le plugin n’a pas pu être modifié.',
      );
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="plugin-controls" aria-label="Fonctionnalités">
      <h3>Fonctionnalités</h3>
      {snapshot.plugins.items.map((plugin) => (
        <div key={plugin.id}>
          <label className="plugin-row">
            <input
              type="checkbox"
              aria-label={`Activer ${plugin.name}`}
              checked={plugin.enabled}
              disabled={!online || !!busy || connecting || dirty || plugin.phase === 'unsupported'}
              onChange={(event) =>
                void toggle(plugin, (event.currentTarget as HTMLInputElement).checked)
              }
            />
            <span>
              <strong>{plugin.name}</strong>
              <span className={`plugin-phase ${plugin.phase}`} role="status">
                {busy === plugin.id
                  ? 'En cours…'
                  : plugin.phase === 'enabled'
                    ? 'Actif'
                    : plugin.phase === 'error'
                      ? 'Erreur'
                      : plugin.phase === 'unsupported'
                        ? 'Indisponible'
                        : 'Désactivé'}
              </span>
              <small>{plugin.description}</small>
              <small>
                {[
                  plugin.keys.length ? `Touches ${keyRanges(plugin.keys)}` : '',
                  plugin.dials.length ? `Potards ${keyRanges(plugin.dials)}` : '',
                  plugin.lcds.length ? 'Écran LCD' : '',
                ]
                  .filter(Boolean)
                  .join(' · ') || 'Aucun contrôle réservé'}
              </small>
            </span>
          </label>
          {plugin.detail ? (
            <p className={plugin.phase === 'error' ? 'error' : 'field-hint'}>{plugin.detail}</p>
          ) : null}
        </div>
      ))}
      {dirty ? (
        <p className="field-hint">
          Enregistre ou annule l’affectation avant de changer les fonctionnalités.
        </p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {snapshot.plugins.items.some((plugin) => plugin.id === 'discord') ? (
        <DiscordConnection
          snapshot={snapshot}
          disabled={!online || !!busy || dirty}
          onSnapshot={onSnapshot}
          onBusy={setConnecting}
        />
      ) : null}
    </section>
  );
}
