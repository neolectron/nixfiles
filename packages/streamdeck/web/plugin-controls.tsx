import { useState, type ReactNode } from 'react';
import type { Catalogue, Snapshot } from '../src/studio-contract.ts';
import { keyRanges } from './zone-map.tsx';
import * as Api from './api.ts';
import { DiscordConnection } from './discord-connection.tsx';
import { PluginTiles } from './plugin-tiles.tsx';
import { Tabs } from './tabs.tsx';
import type { DropTarget } from './use-tile-drag.ts';

function PluginPanels({
  plugin,
  catalogue,
  tileTarget,
  busy,
  onChooseTile,
  onDropTile,
  onTileTarget,
  children,
  surface,
}: {
  readonly plugin: Snapshot['plugins']['items'][number];
  readonly catalogue: Catalogue | undefined;
  readonly tileTarget: number | null;
  readonly busy: boolean;
  readonly onChooseTile: (action: Catalogue['pluginActions'][number]) => void;
  readonly onDropTile: (action: Catalogue['pluginActions'][number], target: DropTarget) => void;
  readonly onTileTarget: (target: DropTarget | null) => void;
  readonly children: ReactNode;
  readonly surface: 'key' | 'lcd';
}) {
  const actions = catalogue?.pluginActions.filter((action) => action.plugin === plugin.id) ?? [];
  const [selected, setSelected] = useState<'tiles' | 'settings' | null>(null);
  return (
    <Tabs
      id={`plugin-${plugin.id}`}
      label={plugin.name}
      selected={selected ?? (actions.some((action) => action.tile) ? 'tiles' : 'settings')}
      onSelect={setSelected}
      className="editor-tabs plugin-tabs"
      items={[
        {
          id: 'tiles',
          label: 'Tiles',
          content: (
            <>
              <p className="plugin-tile-target" role="status">
                {surface === 'lcd'
                  ? 'Ajouter à la zone LCD sélectionnée'
                  : tileTarget === null
                    ? 'Sélectionne une touche à configurer.'
                    : `Affecter à la touche ${tileTarget + 1}`}
              </p>
              {catalogue ? (
                <PluginTiles
                  actions={actions}
                  busy={busy}
                  canChoose={surface === 'lcd' || tileTarget !== null}
                  surface={surface}
                  onDrop={onDropTile}
                  onTarget={onTileTarget}
                  onChoose={onChooseTile}
                />
              ) : (
                <p className="field-hint">Chargement des tiles…</p>
              )}
            </>
          ),
        },
        { id: 'settings', label: 'Réglages', content: children },
      ]}
    />
  );
}
export function PluginControls({
  snapshot,
  online,
  dirty,
  locked,
  catalogue,
  tileTarget,
  onChooseTile,
  onDropTile,
  onTileTarget,
  onSnapshot,
  surface = 'key',
}: {
  snapshot: Snapshot;
  online: boolean;
  dirty: boolean;
  locked: boolean;
  catalogue: Catalogue | undefined;
  tileTarget: number | null;
  onChooseTile: (action: Catalogue['pluginActions'][number]) => void;
  onDropTile: (action: Catalogue['pluginActions'][number], target: DropTarget) => void;
  onTileTarget: (target: DropTarget | null) => void;
  onSnapshot: (snapshot: Snapshot) => void;
  surface?: 'key' | 'lcd';
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
            <summary aria-label={`Configurer ${plugin.name}`} title={plugin.description}>
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
              <PluginPanels
                plugin={plugin}
                catalogue={catalogue}
                tileTarget={tileTarget}
                busy={!online || !!busy || connecting || locked}
                onChooseTile={onChooseTile}
                onDropTile={onDropTile}
                onTileTarget={onTileTarget}
                surface={surface}
              >
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
                    disabled={!online || !!busy || dirty || locked}
                    onSnapshot={onSnapshot}
                    onBusy={setConnecting}
                  />
                ) : null}
              </PluginPanels>
            </div>
          </details>
          <label className="plugin-toggle">
            <input
              type="checkbox"
              aria-label={`Activer ${plugin.name}`}
              checked={plugin.enabled}
              disabled={
                !online || !!busy || connecting || dirty || locked || plugin.phase === 'unsupported'
              }
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
      {dirty ? <p className="field-hint">Modifications non enregistrées.</p> : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
