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
    <section className="plugin-controls" aria-label="Activation et configuration des plugins">
      {snapshot.plugins.items.map((plugin) => (
        <div key={plugin.id} className="plugin-entry">
          <details className="plugin-details">
            <summary aria-label={`Configurer ${plugin.name}`}>
              <svg
                className="plugin-chevron"
                width={16}
                height={16}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                aria-hidden="true"
              >
                <path d="m9 5 7 7-7 7" />
              </svg>
              <span className="plugin-summary-label">
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
              </span>
            </summary>
            <div className="plugin-body">
              <p className="field-hint">{plugin.description}</p>
              <p className="plugin-controls-used">
                {[
                  plugin.keys.length ? `Touches ${keyRanges(plugin.keys)}` : '',
                  plugin.dials.length ? `Potards ${keyRanges(plugin.dials)}` : '',
                  plugin.lcds.length ? 'Écran LCD' : '',
                ]
                  .filter(Boolean)
                  .join(' · ') || 'Aucun contrôle réservé'}
              </p>
              {plugin.id === 'discord' ? (
                <DiscordConnection
                  snapshot={snapshot}
                  disabled={!online || !!busy || dirty}
                  onSnapshot={onSnapshot}
                  onBusy={setConnecting}
                />
              ) : null}
            </div>
          </details>
          <label className="plugin-toggle">
            <input
              type="checkbox"
              aria-label={`Activer ${plugin.name}`}
              checked={plugin.enabled}
              disabled={!online || !!busy || connecting || dirty || plugin.phase === 'unsupported'}
              onChange={(event) =>
                void toggle(plugin, (event.currentTarget as HTMLInputElement).checked)
              }
            />
          </label>
          {plugin.detail ? (
            <p className={plugin.phase === 'error' ? 'error' : 'field-hint'}>{plugin.detail}</p>
          ) : null}
        </div>
      ))}
      {dirty ? (
        <p className="field-hint">
          Enregistre ou annule l’affectation dans Édition avant de changer les plugins.
        </p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
