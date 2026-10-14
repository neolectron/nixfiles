import { useState } from 'react';
import { Schema } from 'effect';
import * as Layout from '../src/lcd-layout.ts';
import type { Snapshot, Catalogue } from '../src/studio-contract.ts';
import * as Fields from '../src/plugin-fields.ts';
import { PluginFields } from './plugin-fields.tsx';
import { invariant } from '../src/errors.ts';

function TileFields({
  tile,
  catalogue,
  snapshot,
  disabled,
  onChange,
}: {
  tile: Layout.Tile;
  catalogue: Catalogue;
  snapshot: Snapshot;
  disabled: boolean;
  onChange: (tile: Layout.Tile) => void;
}) {
  const info = catalogue.pluginActions.find(
    (action) => action.plugin === tile.plugin && action.id === tile.action,
  );
  const [values, setValues] = useState<Record<string, string>>({
    plugin: tile.plugin,
    command: tile.action,
    ...Fields.draft(info?.schema, tile.input),
  });
  const [error, setError] = useState('');
  return (
    <>
      <label className="field">
        Nom
        <input
          value={tile.label}
          disabled={disabled}
          onChange={(event) => onChange({ ...tile, label: event.currentTarget.value })}
        />
      </label>
      <label className="field">
        Largeur de la tile (px)
        <input
          aria-label="Largeur de la tile LCD"
          type="number"
          min={40}
          max={8192}
          value={tile.width}
          disabled={disabled}
          onChange={(event) => onChange({ ...tile, width: Number(event.currentTarget.value) })}
        />
      </label>
      <label className="field">
        Afficher pour cette application
        <input
          aria-label="Application de la tile LCD"
          value={tile.application}
          placeholder="Toujours · app_id exact sinon"
          disabled={disabled}
          onChange={(event) => onChange({ ...tile, application: event.currentTarget.value })}
        />
      </label>
      <PluginFields
        catalogue={catalogue}
        snapshot={snapshot}
        values={values}
        label={tile.label}
        busy={disabled}
        surface="lcd"
        onChange={(next, label) => {
          setValues(next);
          const action = catalogue.pluginActions.find(
            (entry) => entry.plugin === next.plugin && entry.id === next.command,
          );
          try {
            const input = Schema.decodeUnknownSync(Schema.Json)(Fields.input(action?.schema, next));
            setError('');
            onChange({
              ...tile,
              label,
              plugin: next.plugin ?? '',
              action: next.command ?? '',
              input,
            });
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Paramètres invalides.');
            onChange({ ...tile, input: next['input:$root'] ?? '' });
          }
        }}
      />
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
export function LcdEditor({
  lcd,
  snapshot,
  catalogue,
  selected,
  disabled,
  onChange,
  onNavigate,
  onSelect,
  chosen,
  onZone,
}: {
  lcd: Snapshot['lcds'][number];
  snapshot: Snapshot;
  catalogue: Catalogue;
  selected: string | null;
  disabled: boolean;
  onChange: (config: Layout.Configuration) => void;
  onNavigate: (command: Layout.Command) => void;
  onSelect: (id: string | null) => void;
  chosen: string | null;
  onZone: (id: string | null) => void;
}) {
  const config = snapshot.configuration.profile.lcd ?? Layout.empty;
  const navigation = snapshot.lcdLayout?.navigation ?? {};
  const [folderName, setFolderName] = useState('');
  const [error, setError] = useState('');
  const zones = config.zones.filter((entry) => entry.lcd === lcd.index);
  const selectedOwner = zones.find((candidate) =>
    candidate.pages.some((page) => page.some((entry) => entry.id === selected)),
  );
  const zone = selectedOwner ?? zones.find((entry) => entry.id === chosen) ?? zones[0];
  const current = zone ? (navigation[zone.id] ?? Layout.root) : Layout.root;
  const content = zone ? Layout.container(config, zone, current.folder) : undefined;
  const page = Math.min(current.page, (content?.pages.length ?? 1) - 1);
  const items = content?.pages[page] ?? [];
  const tile = items.find((entry) => entry.id === selected);
  const mutate = (
    change: (next: {
      zones: Array<Layout.Configuration['zones'][number]>;
      folders: Array<Layout.Configuration['folders'][number]>;
    }) => void,
  ) => {
    const next = structuredClone(config);
    change(
      next as {
        zones: Array<Layout.Configuration['zones'][number]>;
        folders: Array<Layout.Configuration['folders'][number]>;
      },
    );
    onChange(next);
  };
  const updateZone = (change: Partial<NonNullable<typeof zone>>) =>
    mutate((next) => {
      next.zones = next.zones.map((entry) =>
        entry.id === zone?.id ? { ...entry, ...change } : entry,
      );
    });
  const updateItems = (change: (items: Layout.Tile[]) => void) =>
    mutate((next) => {
      const parent = current.folder
        ? next.folders.find((entry) => entry.id === current.folder)
        : next.zones.find((entry) => entry.id === zone?.id);
      if (parent) change(parent.pages[page] as Layout.Tile[]);
    });
  return (
    <section className="inspector lcd-inspector">
      <h2>Écran LCD</h2>
      <div className="lcd-zone-toolbar">
        <label className="field">
          Zone
          <select
            aria-label="Zone LCD à éditer"
            value={zone?.id ?? ''}
            disabled={disabled}
            onChange={(event) => {
              onZone(event.currentTarget.value);
              onSelect(null);
            }}
          >
            {!zones.length ? <option value="">Aucune zone</option> : null}
            {zones.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={disabled}
          onClick={() => {
            const sorted = zones.toSorted((a, b) => a.x - b.x);
            let x = 0;
            for (const entry of sorted) {
              if (entry.x - x >= 100) break;
              x = Math.max(x, entry.x + entry.width);
            }
            if (lcd.width - x < 40) {
              setError('Réduis une zone pour libérer de la place.');
              return;
            }
            const id = crypto.randomUUID();
            mutate((next) =>
              next.zones.push({
                id,
                name: `Zone LCD ${zones.length + 1}`,
                lcd: lcd.index,
                x,
                width: Math.min(400, lcd.width - x),
                application: '',
                pages: [[]],
              }),
            );
            onZone(id);
            onSelect(null);
            setError('');
          }}
        >
          Ajouter une zone LCD
        </button>
      </div>
      {zone ? (
        <>
          <label className="field">
            Nom de la zone
            <input
              aria-label="Nom de la zone LCD"
              value={zone.name}
              disabled={disabled}
              onChange={(event) => updateZone({ name: event.currentTarget.value })}
            />
          </label>
          <div className="field-row">
            <label className="field">
              Position (px)
              <input
                aria-label="Position de la zone LCD"
                type="number"
                min={0}
                max={lcd.width - 40}
                value={zone.x}
                disabled={disabled}
                onChange={(event) => updateZone({ x: Number(event.currentTarget.value) })}
              />
            </label>
            <label className="field">
              Largeur (px)
              <input
                aria-label="Largeur de la zone LCD"
                type="number"
                min={40}
                max={lcd.width}
                value={zone.width}
                disabled={disabled}
                onChange={(event) => updateZone({ width: Number(event.currentTarget.value) })}
              />
            </label>
          </div>
          <label className="field">
            Afficher la zone pour cette application
            <input
              aria-label="Application de la zone LCD"
              value={zone.application}
              placeholder="Toujours · app_id exact sinon"
              disabled={disabled}
              onChange={(event) => updateZone({ application: event.currentTarget.value })}
            />
          </label>
          <label className="field">
            Dossier
            <select
              aria-label="Dossier LCD à éditer"
              value={current.folder ?? ''}
              onChange={(event) =>
                onNavigate({
                  zone: zone.id,
                  operation: event.currentTarget.value ? 'open' : 'root',
                  ...(event.currentTarget.value ? { folder: event.currentTarget.value } : {}),
                })
              }
              disabled={disabled}
            >
              <option value="">Racine</option>
              {config.folders.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <div className="lcd-editor-pagination">
            <button
              aria-label="Page LCD précédente dans l’éditeur"
              disabled={disabled || (content?.pages.length ?? 0) < 2}
              onClick={() => onNavigate({ zone: zone.id, operation: 'previous' })}
            >
              ←
            </button>
            <span>
              Page {page + 1} / {content?.pages.length ?? 1}
            </span>
            <button
              aria-label="Page LCD suivante dans l’éditeur"
              disabled={disabled || (content?.pages.length ?? 0) < 2}
              onClick={() => onNavigate({ zone: zone.id, operation: 'next' })}
            >
              →
            </button>
            <button
              disabled={disabled}
              onClick={() => {
                mutate((next) => {
                  const parent = current.folder
                    ? next.folders.find((entry) => entry.id === current.folder)
                    : next.zones.find((entry) => entry.id === zone.id);
                  if (parent) (parent.pages as Layout.Tile[][]).push([]);
                });
              }}
            >
              Ajouter une page LCD
            </button>
          </div>
          <div className="lcd-virtual-strip" aria-label="Toutes les tiles de la page LCD">
            {items.map((entry, index) => (
              <div className="lcd-item-row" key={entry.id}>
                <button
                  className={entry.id === selected ? 'selected' : ''}
                  onClick={() => onSelect(entry.id)}
                >
                  {entry.label} <small>{entry.width} px</small>
                </button>
                <button
                  aria-label={`Déplacer ${entry.label} à gauche`}
                  disabled={disabled || index === 0}
                  onClick={() =>
                    updateItems((values) => {
                      const previous = invariant(values[index - 1], 'lcd-editor');
                      values[index - 1] = entry;
                      values[index] = previous;
                    })
                  }
                >
                  ←
                </button>
                <button
                  aria-label={`Déplacer ${entry.label} à droite`}
                  disabled={disabled || index === items.length - 1}
                  onClick={() =>
                    updateItems((values) => {
                      const after = invariant(values[index + 1], 'lcd-editor');
                      values[index + 1] = entry;
                      values[index] = after;
                    })
                  }
                >
                  →
                </button>
              </div>
            ))}
            {!items.length ? (
              <p className="field-hint">Glisse une tile du plugin sur le LCD.</p>
            ) : null}
          </div>
          {items.reduce((sum, entry) => sum + entry.width, current.folder ? 100 : 0) >
          zone.width ? (
            <div className="lcd-editor-pagination">
              <button
                aria-label="Faire défiler le LCD à gauche"
                disabled={disabled}
                onClick={() =>
                  onNavigate({
                    zone: zone.id,
                    operation: 'scroll',
                    delta: -Math.round(zone.width / 2),
                  })
                }
              >
                ←
              </button>
              <span>Contenu horizontal</span>
              <button
                aria-label="Faire défiler le LCD à droite"
                disabled={disabled}
                onClick={() =>
                  onNavigate({
                    zone: zone.id,
                    operation: 'scroll',
                    delta: Math.round(zone.width / 2),
                  })
                }
              >
                →
              </button>
            </div>
          ) : null}
          {tile ? (
            <div className="lcd-tile-settings">
              <h3>{tile.label}</h3>
              <TileFields
                key={tile.id}
                tile={tile}
                catalogue={catalogue}
                snapshot={snapshot}
                disabled={disabled}
                onChange={(next) =>
                  updateItems((values) => {
                    const index = values.findIndex((entry) => entry.id === tile.id);
                    if (index >= 0) values[index] = next;
                  })
                }
              />
              <label className="field">
                Déplacer vers un dossier
                <select
                  aria-label="Déplacer la tile LCD dans un dossier"
                  value=""
                  disabled={disabled}
                  onChange={(event) => {
                    const destination = event.currentTarget.value;
                    if (!destination) return;
                    mutate((next) => {
                      const parent = current.folder
                        ? next.folders.find((entry) => entry.id === current.folder)
                        : next.zones.find((entry) => entry.id === zone.id);
                      const target = next.folders.find((entry) => entry.id === destination);
                      if (parent && target) {
                        const values = parent.pages[page] as Layout.Tile[];
                        values.splice(
                          values.findIndex((entry) => entry.id === tile.id),
                          1,
                        );
                        (target.pages[0] as Layout.Tile[]).push(tile);
                      }
                    });
                    onSelect(null);
                  }}
                >
                  <option value="">Choisir un dossier</option>
                  {config.folders
                    .filter((folder) => folder.id !== current.folder)
                    .map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                </select>
              </label>
              <button
                disabled={disabled}
                onClick={() => {
                  updateItems((values) =>
                    values.splice(
                      values.findIndex((entry) => entry.id === tile.id),
                      1,
                    ),
                  );
                  onSelect(null);
                }}
              >
                Retirer cette tile LCD
              </button>
            </div>
          ) : null}
          <div className="lcd-folder-create">
            <label className="field">
              Nouveau dossier LCD
              <input
                aria-label="Nom du nouveau dossier LCD"
                value={folderName}
                disabled={disabled}
                onChange={(event) => setFolderName(event.currentTarget.value)}
              />
            </label>
            <button
              disabled={disabled || !folderName.trim()}
              onClick={() => {
                mutate((next) =>
                  next.folders.push({
                    id: crypto.randomUUID(),
                    name: folderName.trim(),
                    pages: [[]],
                  }),
                );
                setFolderName('');
              }}
            >
              Créer le dossier LCD
            </button>
          </div>
          <button
            disabled={disabled}
            onClick={() => {
              mutate((next) => {
                next.zones = next.zones.filter((entry) => entry.id !== zone.id);
              });
              onZone(null);
              onSelect(null);
            }}
          >
            Retirer cette zone LCD
          </button>
        </>
      ) : (
        <p className="field-hint">Le mixer reste visible en dehors des zones configurées.</p>
      )}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
