import { invariant } from '../src/errors.ts';
import { useState, type FormEvent } from 'react';
import { Effect } from 'effect';
import type { Snapshot } from '../src/studio-contract.ts';
import * as Api from './api.ts';
import { keyRanges, zoneLabel, ZoneMap, TargetPreview } from './zone-map.tsx';
type KeyView = Snapshot['keys'][number];
type Props = {
  snapshot: Snapshot;
  selected: KeyView | undefined;
  online: boolean;
  dirty: boolean;
  onSnapshot: (snapshot: Snapshot) => void;
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'La disposition n’a pas pu être modifiée.';
const Arrow = ({ previous = false }: { previous?: boolean }) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    aria-hidden={true}
  >
    <path d={previous ? 'm14 5-7 7 7 7' : 'm10 5 7 7-7 7'} />
  </svg>
);
function ZoneEditor({
  snapshot,
  id,
  disabled,
  run,
  close,
}: {
  snapshot: Snapshot;
  id: string;
  disabled: boolean;
  run: (effect: Effect.Effect<Snapshot, unknown>) => Promise<void>;
  close: () => void;
}) {
  const existing = snapshot.layout.zones.find((zone) => zone.id === id);
  const [name, setName] = useState('');
  const [keys, setKeys] = useState<number[]>([...(existing?.keys ?? [])]);
  const allowed = snapshot.keys
    .filter((key) => !key.pinned && (key.zone === 'deck' || key.zone === id))
    .map((key) => key.index);
  const fixed = snapshot.keys.filter((key) => keys.includes(key.index) && key.pinned).length;
  return (
    <form
      className="zone-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void run(
          Api.organize(
            existing
              ? { operation: 'resize-zone', zone: id, keys, revision: snapshot.layout.revision }
              : {
                  operation: 'create-zone',
                  name: name.trim(),
                  keys,
                  revision: snapshot.layout.revision,
                },
          ),
        );
      }}
    >
      <h3>{existing ? `Touches de ${existing.name}` : 'Créer une zone'}</h3>
      {existing ? null : (
        <label className="field">
          <span>Nom de la zone</span>
          <input
            value={name}
            required={true}
            maxLength={80}
            disabled={disabled}
            onChange={(event) => setName((event.currentTarget as HTMLInputElement).value)}
          />
        </label>
      )}
      <p className="field-hint">
        Clique sur les touches à inclure. Les touches fixes restent en place ; les touches d’autres
        zones sont indisponibles.
      </p>
      <ZoneMap
        snapshot={snapshot}
        keys={keys}
        allowed={allowed}
        disabled={disabled}
        onToggle={(key) =>
          setKeys((before) =>
            before.includes(key) ? before.filter((item) => item !== key) : [...before, key],
          )
        }
      />
      <p className="zone-capacity" aria-live="polite">
        {keys.length
          ? `Touches ${keyRanges(keys)} · ${keys.length - fixed} icônes par page, ou ${Math.max(0, keys.length - fixed - 1)} + Retour pour un dossier.`
          : 'Sélectionne au moins une touche.'}
      </p>
      <p className="field-hint">
        Les raccourcis suivent leurs touches sur toutes les pages. Les touches retirées reviennent à
        la zone principale. Après enregistrement, les zones concernées reviennent à leur première
        page.
      </p>
      <div className="form-actions">
        <button
          type="submit"
          className="primary"
          disabled={disabled || !keys.length || (!existing && !name.trim())}
        >
          {existing ? 'Enregistrer la zone' : 'Créer la zone'}
        </button>
        <button type="button" onClick={close}>
          Fermer
        </button>
      </div>
    </form>
  );
}
export function LayoutControls({ snapshot, selected, online, dirty, onSnapshot }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [folderName, setFolderName] = useState('');
  const [folderTarget, setFolderTarget] = useState('current');
  const [editing, setEditing] = useState<string | null>(null);
  const [renameId, setRenameId] = useState('');
  const [rename, setRename] = useState('');
  const disabled = busy || dirty || !online;
  const run = async (effect: Effect.Effect<Snapshot, unknown>) => {
    setBusy(true);
    setError('');
    try {
      onSnapshot(await Api.run(effect));
    } catch (candidateError) {
      setError(message(candidateError));
    } finally {
      setBusy(false);
    }
  };
  const folder = (event: FormEvent) => {
    event.preventDefault();
    if (selected)
      void run(
        Api.organize({
          operation: 'create-folder',
          key: selected.index,
          name: folderName.trim(),
          address: selected.address,
          target: folderTarget,
        }),
      );
  };
  return (
    <section className="layout-controls" id="zones" aria-label="Dossiers, zones et pages">
      <div className="zone-navigation">
        {snapshot.layout.zones.map((zone) => (
          <div key={zone.id} className="zone-navigation-row">
            <div className="zone-path">
              <button
                disabled={disabled}
                onClick={() => void run(Api.navigate({ zone: zone.id, operation: 'root' }))}
                title="Revenir à la racine de cette zone"
              >
                {zone.name}
              </button>
              {zone.breadcrumbs.map((crumb) => (
                <span key={crumb.id}>
                  <span aria-hidden={true}>{' / '}</span>
                  {crumb.name}
                </span>
              ))}
              <small className="zone-range">{`Touches ${keyRanges(zone.keys)}`}</small>
              <button
                className="zone-edit-link"
                disabled={disabled}
                onClick={() => setEditing(zone.id === 'deck' ? 'new' : zone.id)}
              >
                {zone.id === 'deck' ? 'Créer une zone' : 'Modifier les touches'}
              </button>
            </div>
            <div className="zone-page-actions">
              {zone.folder ? (
                <button
                  disabled={disabled}
                  onClick={() => void run(Api.navigate({ zone: zone.id, operation: 'back' }))}
                  aria-label={`Retour dans ${zone.name}`}
                >
                  Retour
                </button>
              ) : null}
              <button
                disabled={disabled || zone.pages < 2}
                aria-label={`Page précédente · ${zone.name}`}
                onClick={() => void run(Api.navigate({ zone: zone.id, operation: 'previous' }))}
              >
                <Arrow previous={true} />
              </button>
              <span
                className="page-number"
                aria-label={`Page de ${zone.name}`}
              >{`${zone.page + 1} / ${zone.pages}`}</span>
              <button
                disabled={disabled || zone.pages < 2}
                aria-label={`Page suivante · ${zone.name}`}
                onClick={() => void run(Api.navigate({ zone: zone.id, operation: 'next' }))}
              >
                <Arrow />
              </button>
              <button
                disabled={disabled}
                onClick={() =>
                  void run(
                    Api.organize({
                      operation: 'add-page',
                      zone: zone.id,
                      revision: snapshot.layout.revision,
                    }),
                  )
                }
                aria-label={`Ajouter une page · ${zone.name}`}
              >
                Ajouter une page
              </button>
            </div>
          </div>
        ))}
      </div>
      {editing ? (
        <ZoneEditor
          key={editing}
          snapshot={snapshot}
          id={editing}
          disabled={disabled}
          run={run}
          close={() => setEditing(null)}
        />
      ) : null}
      <details className="organization-details">
        <summary>Organiser les dossiers et les zones</summary>
        <div className="organization-forms">
          <form onSubmit={folder}>
            <h3>Nouveau dossier</h3>
            <p className="field-hint">
              {selected && !selected.binding
                ? `Il sera placé sur la touche ${selected.index + 1}.`
                : 'Sélectionne une touche libre dans l’aperçu.'}
            </p>
            <label className="field">
              <span>Nom du nouveau dossier</span>
              <input
                required={true}
                maxLength={80}
                value={folderName}
                disabled={disabled}
                onChange={(event) => setFolderName((event.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <label className="field">
              <span>Zone du nouveau dossier</span>
              <select
                value={folderTarget}
                disabled={disabled}
                onChange={(event) =>
                  setFolderTarget((event.currentTarget as HTMLSelectElement).value)
                }
              >
                <option value="current">Zone de la touche sélectionnée</option>
                {snapshot.layout.zones.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zoneLabel(zone)}
                  </option>
                ))}
              </select>
            </label>
            {selected ? (
              <TargetPreview
                snapshot={snapshot}
                zoneId={folderTarget === 'current' ? selected.zone : folderTarget}
                folder={true}
              />
            ) : null}
            <button
              type="submit"
              disabled={disabled || !selected || !!selected.binding || !folderName.trim()}
            >
              Créer le dossier
            </button>
          </form>
          {snapshot.layout.folders.length ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  Api.organize({
                    operation: 'rename-folder',
                    id: renameId,
                    name: rename.trim(),
                    revision: snapshot.layout.revision,
                  }),
                );
              }}
            >
              <h3>Renommer un dossier</h3>
              <label className="field">
                <span>Dossier à renommer</span>
                <select
                  value={renameId}
                  disabled={disabled}
                  required={true}
                  onChange={(event) => {
                    const id = (event.currentTarget as HTMLSelectElement).value;
                    setRenameId(id);
                    setRename(
                      snapshot.layout.folders.find((candidateFolder) => candidateFolder.id === id)
                        ?.name ?? '',
                    );
                  }}
                >
                  <option value="">Choisir un dossier</option>
                  {snapshot.layout.folders.map((candidateFolder) => (
                    <option key={candidateFolder.id} value={candidateFolder.id}>
                      {candidateFolder.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Nouveau nom du dossier</span>
                <input
                  required={true}
                  maxLength={80}
                  disabled={disabled}
                  value={rename}
                  onChange={(event) => setRename((event.currentTarget as HTMLInputElement).value)}
                />
              </label>
              <button type="submit" disabled={disabled || !renameId || !rename.trim()}>
                Renommer
              </button>
            </form>
          ) : null}
        </div>
      </details>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {dirty ? (
        <p className="field-hint">
          Enregistre ou annule l’affectation avant de changer la disposition.
        </p>
      ) : null}
    </section>
  );
}
export function ShortcutOrganization({ snapshot, selected, online, dirty, onSnapshot }: Props) {
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!selected?.id || selected.navigation) return null;
  const disabled = busy || dirty || !online;
  const run = async (effect: Effect.Effect<Snapshot, unknown>) => {
    setBusy(true);
    setError('');
    try {
      onSnapshot(await Api.run(effect));
    } catch (candidateError) {
      setError(message(candidateError));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="shortcut-organization">
      <h3>Rangement</h3>
      <label className="pin-field">
        <input
          type="checkbox"
          checked={selected.pinned}
          disabled={disabled}
          onChange={(event) =>
            void run(
              Api.organize({
                operation: 'pin',
                key: selected.index,
                value: (event.currentTarget as HTMLInputElement).checked,
                address: selected.address,
              }),
            )
          }
        />
        <span>Fixer sur toutes les pages et dossiers de cette zone</span>
      </label>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            Api.organize({
              operation: 'move',
              id: invariant(selected.id, 'layout-controls'),
              destination,
              revision: snapshot.layout.revision,
            }),
          );
        }}
      >
        <label className="field">
          <span>Déplacer vers</span>
          <select
            value={destination}
            required={true}
            disabled={disabled}
            onChange={(event) => setDestination((event.currentTarget as HTMLSelectElement).value)}
          >
            <option value="">Choisir une destination</option>
            <optgroup label="Zones">
              {snapshot.layout.zones.map((zone) => (
                <option key={zone.id} value={`zone:${zone.id}`}>
                  {zone.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Dossiers">
              {snapshot.layout.folders.map((folder) => (
                <option key={folder.id} value={`folder:${folder.id}`}>
                  {folder.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <button type="submit" disabled={disabled || !destination}>
          Déplacer le raccourci
        </button>
      </form>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
