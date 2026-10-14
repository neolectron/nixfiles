import { invariant } from '../src/errors.ts';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HeldAction } from './held-action.tsx';
import { Effect, Fiber, Schedule } from 'effect';
import type { ActionId, Catalogue, Snapshot } from '../src/studio-contract.ts';
import { KeyCard } from '../src/ui/key-card.tsx';
import * as Api from './api.ts';
import { LayoutControls, ShortcutOrganization } from './layout-controls.tsx';
import { TargetPreview, zoneLabel } from './zone-map.tsx';
import * as Fields from '../src/plugin-fields.ts';
import { PluginFields } from './plugin-fields.tsx';
import { PluginControls } from './plugin-controls.tsx';
import { EditorTabs, type EditorTab } from './editor-tabs.tsx';
import { DeckHeading } from './deck-heading.tsx';
import { KeyGrid } from './key-grid.tsx';
import { DialControl } from './dial-control.tsx';
import type { KeyTrigger } from '../src/press-trigger.ts';
import { draftOf, type Draft } from './key-draft.ts';
import { useProfileEditor } from './use-profile-editor.ts';
import './style.css';
function Icon({
  name,
  size = 20,
}: {
  name: 'plus' | 'left' | 'right' | 'play' | 'save';
  size?: number;
}) {
  const paths = {
    plus: 'M12 5v14M5 12h14',
    left: 'm14 6-6 6 6 6',
    right: 'm10 6 6 6-6 6',
    play: 'm8 5 11 7-11 7Z',
    save: 'M5 3h12l4 4v14H3V3h2Zm2 0v6h10V3M7 21v-8h10v8',
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
    >
      <path d={paths[name]} />
    </svg>
  );
}
type KeyView = Snapshot['keys'][number];
type Selection = {
  kind: 'key' | 'dial';
  index: number;
};
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : 'La requête a échoué.';
function KeyInspector({
  selected,
  catalogue,
  snapshot,
  online,
  onSnapshot,
  draft,
  onDraft,
  onOrganize,
  onNavigate,
  dirty,
  busy,
}: {
  selected: KeyView;
  catalogue: Catalogue;
  snapshot: Snapshot;
  online: boolean;
  onSnapshot: (snapshot: Snapshot) => void;
  draft: Draft;
  onDraft: (draft: Draft) => void;
  onOrganize: (
    command: import('../src/studio-contract.ts').Organize,
  ) => Effect.Effect<Snapshot, unknown>;
  onNavigate: (
    command: import('../src/studio-contract.ts').Navigate,
  ) => Effect.Effect<Snapshot, unknown>;
  dirty: boolean;
  busy: boolean;
}) {
  const setDraft = onDraft;
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const definition = catalogue.actions.find((action) => action.id === draft.action);
  const draftTile =
    draft.action === 'plugin'
      ? catalogue.pluginActions.find(
          (action) => action.plugin === draft.values.plugin && action.id === draft.values.command,
        )?.tile
      : undefined;
  const heldAction =
    selected.binding?.action === 'plugin' &&
    catalogue.pluginActions.find(
      (action) =>
        selected.binding?.action === 'plugin' &&
        action.plugin === selected.binding.parameters.plugin &&
        action.id === selected.binding.parameters.command,
    )?.interaction === 'hold';
  const draftHeld =
    draft.action === 'plugin' &&
    catalogue.pluginActions.find(
      (action) => action.plugin === draft.values.plugin && action.id === draft.values.command,
    )?.interaction === 'hold';
  const invalidTrigger = draftHeld && draft.activation === 'double-tap';
  const gestureTest = heldAction || (selected.binding?.trigger?.type ?? 'press') !== 'press';
  const unavailable =
    !selected.binding ||
    dirty ||
    busy ||
    testing ||
    !online ||
    (selected.binding.action === 'plugin' &&
      !snapshot.plugins.items.find(
        (plugin) =>
          selected.binding?.action === 'plugin' && plugin.id === selected.binding.parameters.plugin,
      )?.enabled);
  const test = async () => {
    setTesting(true);
    setError('');
    try {
      onSnapshot(
        await Api.run(
          selected.status === 'running'
            ? Api.cancel(selected.index, selected.address)
            : Api.trigger(selected.index, selected.address),
        ),
      );
    } catch (candidateError) {
      setError(messageOf(candidateError));
    } finally {
      setTesting(false);
    }
  };
  if (selected.navigation)
    return (
      <section className="inspector">
        <h2>Retour du dossier</h2>
        <button
          disabled={busy || !online}
          onClick={() => {
            void Api.run(onNavigate({ zone: selected.zone, operation: 'back' })).catch((cause) =>
              setError(messageOf(cause)),
            );
          }}
        >
          Revenir
        </button>
      </section>
    );
  return (
    <section className="inspector" aria-labelledby="inspector-title">
      <div className="inspector-heading">
        <h2 id="inspector-title">{`Touche ${selected.index + 1}`}</h2>
        <span className="coordinate">{`${selected.row + 1} : ${selected.column + 1}`}</span>
      </div>
      <form onSubmit={(event) => event.preventDefault()}>
        <label className="field">
          <span>Action</span>
          <select
            value={draft.action}
            title={definition?.description}
            disabled={busy}
            onChange={(event) => {
              const id = (
                event.currentTarget as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
              ).value as ActionId | '';
              const action = catalogue.actions.find((currentAction) => currentAction.id === id);
              setDraft({
                ...draft,
                action: id,
                label: action?.name ?? '',
                values: Object.fromEntries(
                  Object.entries(action?.defaults ?? {}).map(([key, value]) => [
                    key,
                    Array.isArray(value) ? value.join('\n') : String(value),
                  ]),
                ),
              });
              setError('');
            }}
          >
            <option value="">Aucune action</option>
            {catalogue.actions.map((action) => (
              <option key={action.id} value={action.id}>
                {action.name}
              </option>
            ))}
          </select>
        </label>
        {definition ? (
          <label className="field">
            <span>Nom sur la touche</span>
            <input
              value={draft.label}
              maxLength={80}
              disabled={busy}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  label: (
                    event.currentTarget as
                      | HTMLInputElement
                      | HTMLSelectElement
                      | HTMLTextAreaElement
                  ).value,
                })
              }
            />
          </label>
        ) : null}
        {draft.action === 'plugin' ? (
          <PluginFields
            catalogue={catalogue}
            snapshot={invariant(snapshot, 'editor-snapshot')}
            values={draft.values}
            label={draft.label}
            busy={busy}
            onChange={(values, label) => setDraft({ ...draft, values, label })}
          />
        ) : null}
        {definition ? (
          <label className="field">
            <span>Déclenchement</span>
            <select
              aria-label="Déclenchement"
              value={draft.activation}
              disabled={busy}
              onChange={(event) => {
                const activation = (event.currentTarget as HTMLSelectElement)
                  .value as KeyTrigger['type'];
                setDraft({
                  ...draft,
                  activation,
                  milliseconds: activation === 'double-tap' ? '350' : '600',
                });
              }}
            >
              <option value="press">Appui simple</option>
              <option value="long-press">Appui long</option>
              <option value="double-tap" disabled={!!draftHeld}>
                Double appui
              </option>
            </select>
          </label>
        ) : null}
        {definition && draft.activation !== 'press' ? (
          <label className="field">
            <span>
              {draft.activation === 'long-press'
                ? 'Durée minimale (ms)'
                : 'Intervalle maximal (ms)'}
            </span>
            <input
              aria-label="Délai du déclenchement"
              type="number"
              min={100}
              max={draft.activation === 'long-press' ? 10000 : 1000}
              step={1}
              required={true}
              value={draft.milliseconds}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, milliseconds: event.currentTarget.value })}
            />
          </label>
        ) : null}
        {invalidTrigger ? (
          <p className="error" role="alert">
            Choisis un appui simple ou long pour cette action à maintenir.
          </p>
        ) : null}
        {(definition?.fields ?? []).map((field) => (
          <label key={field.key} className="field" title={field.hint || undefined}>
            {field.hint ? (
              <span id={`hint-${field.key}`} hidden={true}>
                {field.hint}
              </span>
            ) : null}
            <span>{field.label}</span>
            {field.kind === 'folder' || field.kind === 'zone' ? (
              <select
                aria-label={field.label}
                aria-describedby={field.hint ? `hint-${field.key}` : undefined}
                title={field.hint || undefined}
                value={draft.values[field.key] ?? ''}
                required={true}
                disabled={busy}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    values: {
                      ...draft.values,
                      [field.key]: (event.currentTarget as HTMLSelectElement).value,
                    },
                  })
                }
              >
                <option value="">
                  {field.kind === 'folder' ? 'Choisir un dossier' : 'Choisir une zone'}
                </option>
                {field.kind === 'folder'
                  ? snapshot.layout.folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))
                  : [
                      <option
                        key="current"
                        value="current"
                      >{`Zone de cette touche · ${snapshot.layout.zones.find((zone) => zone.id === selected.zone)?.name}`}</option>,
                      ...(draft.action === 'open-folder'
                        ? []
                        : [
                            <option key="audio" value="audio">
                              Mixer audio LCD
                            </option>,
                          ]),
                      ...snapshot.layout.zones.map((zone) => (
                        <option key={zone.id} value={zone.id}>
                          {zoneLabel(zone)}
                        </option>
                      )),
                    ]}
              </select>
            ) : field.kind === 'app' ? (
              <select
                aria-label={field.label}
                aria-describedby={field.hint ? `hint-${field.key}` : undefined}
                title={field.hint || undefined}
                required={true}
                value={draft.values[field.key] ?? ''}
                disabled={busy}
                onChange={(event) => {
                  const app = catalogue.applications.find(
                    (candidateApp) =>
                      candidateApp.id ===
                      (
                        event.currentTarget as
                          | HTMLInputElement
                          | HTMLSelectElement
                          | HTMLTextAreaElement
                      ).value,
                  );
                  setDraft({
                    ...draft,
                    label:
                      draft.label === definition?.name ? (app?.name ?? draft.label) : draft.label,
                    values: {
                      ...draft.values,
                      [field.key]: (
                        event.currentTarget as
                          | HTMLInputElement
                          | HTMLSelectElement
                          | HTMLTextAreaElement
                      ).value,
                    },
                  });
                }}
              >
                <option value="">Choisir une application</option>
                {catalogue.applications.map((app) => (
                  <option key={app.id} value={app.id}>
                    {app.name}
                  </option>
                ))}
              </select>
            ) : field.kind === 'arguments' ? (
              <textarea
                aria-label={field.label}
                aria-describedby={field.hint ? `hint-${field.key}` : undefined}
                title={field.hint || undefined}
                rows={4}
                className="code-input"
                value={draft.values[field.key] ?? ''}
                disabled={busy}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    values: {
                      ...draft.values,
                      [field.key]: (
                        event.currentTarget as
                          | HTMLInputElement
                          | HTMLSelectElement
                          | HTMLTextAreaElement
                      ).value,
                    },
                  })
                }
              />
            ) : (
              <input
                aria-label={field.label}
                aria-describedby={field.hint ? `hint-${field.key}` : undefined}
                title={field.hint || undefined}
                type={field.kind === 'number' ? 'number' : 'text'}
                required={field.key === 'executable'}
                min={field.kind === 'number' ? -9999 : undefined}
                max={field.kind === 'number' ? 9999 : undefined}
                className={
                  field.key === 'executable' || field.key === 'directory' ? 'code-input' : ''
                }
                value={draft.values[field.key] ?? ''}
                disabled={busy}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    values: {
                      ...draft.values,
                      [field.key]: (
                        event.currentTarget as
                          | HTMLInputElement
                          | HTMLSelectElement
                          | HTMLTextAreaElement
                      ).value,
                    },
                  })
                }
              />
            )}
          </label>
        ))}
        {draft.action === 'open-folder' ||
        draft.action === 'page-next' ||
        draft.action === 'page-previous' ? (
          <TargetPreview
            snapshot={invariant(snapshot, 'editor-snapshot')}
            zoneId={
              !draft.values.target || draft.values.target === 'current'
                ? selected.zone
                : draft.values.target
            }
            folder={draft.action === 'open-folder'}
          />
        ) : null}
        {definition ? (
          <div className="draft-preview">
            <KeyCard
              width={112}
              height={112}
              label={draft.label || invariant(definition, 'app').name}
              action={definition.id}
              count={
                draft.action === 'counter'
                  ? dirty
                    ? Number(draft.values.start ?? 0)
                    : selected.count
                  : 0
              }
              status="idle"
              feedback={
                dirty
                  ? draftTile
                    ? { icon: draftTile.icon, tone: 'neutral', text: 'À ENREGISTRER' }
                    : null
                  : selected.feedback
              }
            />
            <span>Aperçu de l’affectation</span>
          </div>
        ) : null}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
      <div className="test-action">
        {gestureTest ? (
          <HeldAction
            key={`${selected.id}/${JSON.stringify(selected.binding?.trigger)}/${snapshot.layout.revision}`}
            keyIndex={selected.index}
            address={selected.address}
            revision={snapshot.layout.revision}
            {...(selected.binding?.trigger ? { trigger: selected.binding.trigger } : {})}
            disabled={unavailable}
            onSnapshot={onSnapshot}
            onError={(candidateError) => setError(messageOf(candidateError))}
          />
        ) : (
          <button className="test-button" disabled={unavailable} onClick={test}>
            <Icon name="play" size={17} />
            {selected.status === 'running'
              ? 'Arrêter la commande'
              : selected.binding?.action === 'open-folder'
                ? 'Ouvrir le dossier'
                : 'Tester l’action'}
          </button>
        )}
      </div>
      <ShortcutOrganization
        key={selected.id}
        snapshot={invariant(snapshot, 'editor-snapshot')}
        selected={selected}
        online={online}
        locked={busy}
        onOrganize={onOrganize}
      />
      {selected.detail ? (
        <div className="command-result">
          <h3>
            {selected.status === 'error'
              ? 'Échec de l’action'
              : selected.status === 'running'
                ? 'Sortie en cours'
                : 'Dernière sortie'}
          </h3>
          <pre className={selected.status === 'error' ? 'error-output' : ''}>{selected.detail}</pre>
        </div>
      ) : null}
    </section>
  );
}
function App() {
  const [liveSnapshot, setLiveSnapshot] = useState<Snapshot>();
  const [catalogue, setCatalogue] = useState<Catalogue>();
  const [online, setOnline] = useState(false);
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<Selection>({ kind: 'key', index: 0 });
  const [tab, setTab] = useState<EditorTab>('edit');
  const [tileTarget, setTileTarget] = useState<number | null>(null);
  const acceptSnapshot = (value: Snapshot) =>
    setLiveSnapshot((previous) =>
      previous?.sessionId === value.sessionId &&
      (previous.inputSequence > value.inputSequence ||
        previous.plugins.revision > value.plugins.revision ||
        (previous.plugins.revision === value.plugins.revision &&
          previous.layout.revision > value.layout.revision))
        ? previous
        : value,
    );
  const editor = useProfileEditor(liveSnapshot, catalogue, acceptSnapshot);
  const snapshot = editor.snapshot;
  const dirty = editor.dirty;
  useEffect(() => {
    const watcher = Effect.runFork(
      Api.observe(
        (value) => {
          acceptSnapshot(value);
          setOnline(true);
        },
        () => setOnline(false),
      ),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(watcher));
    };
  }, []);
  useEffect(() => {
    const loader = Effect.runFork(
      Api.catalogue.pipe(
        Effect.retry(Schedule.spaced(1000)),
        Effect.match({
          onSuccess: setCatalogue,
          onFailure: (candidateError) => setError(messageOf(candidateError)),
        }),
      ),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(loader));
    };
  }, [liveSnapshot?.sessionId]);
  const select = (next: Selection) => {
    if (selection.kind === next.kind && selection.index === next.index) {
      setTab('edit');
      return;
    }
    setSelection(next);
    setTab('edit');
  };
  const selectedKey = snapshot?.keys.find(
    (key) => selection.kind === 'key' && key.index === selection.index,
  );
  const selectedDial = snapshot?.dials.find(
    (dial) => selection.kind === 'dial' && dial.index === selection.index,
  );
  const shortcutsActive =
    snapshot?.plugins.items.find((plugin) => plugin.id === 'shortcuts')?.enabled ?? false;
  const mixerActive =
    snapshot?.plugins.items.find((plugin) => plugin.id === 'audio-mixer')?.enabled ?? false;
  const chooseTile = (action: Catalogue['pluginActions'][number], index = selectedKey?.index) => {
    const target = snapshot?.keys.find((key) => key.index === index);
    if (
      !target ||
      !online ||
      !shortcutsActive ||
      editor.busy ||
      target.navigation ||
      target.pressed ||
      target.status === 'running'
    )
      return;
    select({ kind: 'key', index: target.index });
    const before =
      editor.form(target) ?? draftOf(target.binding, invariant(catalogue, 'editor-catalogue'));
    editor.edit(target, {
      ...before,
      action: 'plugin',
      label: action.tile?.label ?? action.name,
      values: {
        plugin: action.plugin,
        command: action.id,
        ...Fields.draft(action.schema, action.defaults),
      },
      activation: action.interaction === 'hold' ? 'press' : before.activation,
    });
    setTileTarget(null);
    setTab('edit');
  };
  const columns = snapshot ? Math.max(...snapshot.keys.map((key) => key.column)) + 1 : 9;
  const turnPage = (direction: number) => {
    Effect.runFork(
      Api.page(direction).pipe(
        Effect.match({
          onSuccess: acceptSnapshot,
          onFailure: (candidateError) => setError(messageOf(candidateError)),
        }),
      ),
    );
  };
  const currentTapLcd = (dial: Snapshot['dials'][number]) => {
    if (!snapshot || !dial.key) return;
    Effect.runFork(
      Api.lcdTap(dial.index, dial.key, snapshot.page).pipe(
        Effect.match({
          onSuccess: acceptSnapshot,
          onFailure: (candidateError) => setError(messageOf(candidateError)),
        }),
      ),
    );
  };
  return (
    <div className="app-shell">
      <main className="workspace">
        <section className="preview-panel" aria-label="Aperçu du deck">
          <DeckHeading snapshot={snapshot} online={online} />
          <div className="configuration-save">
            <span role="status">
              {!snapshot
                ? 'Chargement…'
                : editor.busy
                  ? 'Enregistrement…'
                  : dirty
                    ? 'Modifications non enregistrées'
                    : 'Configuration enregistrée'}
            </span>
            <button
              type="button"
              className="primary"
              disabled={!dirty || !online || editor.busy || !shortcutsActive}
              onClick={() => void editor.save()}
            >
              <Icon name="save" size={17} />
              Enregistrer
            </button>
            <button type="button" disabled={!dirty || editor.busy} onClick={editor.discard}>
              Annuler
            </button>
          </div>
          {editor.conflict ? (
            <p className="error" role="alert">
              La configuration a changé ailleurs. Ton brouillon est conservé ; annule ou recharge
              avant d’enregistrer.
            </p>
          ) : null}
          {editor.error ? (
            <p className="error" role="alert">
              {editor.error}
            </p>
          ) : null}
          <div className="device" style={{ '--columns': columns } as import('react').CSSProperties}>
            {snapshot ? (
              <KeyGrid
                snapshot={invariant(snapshot, 'editor-snapshot')}
                tileTarget={tileTarget}
                selected={selection.kind === 'key' ? selection.index : null}
                editable={online && shortcutsActive && !editor.busy}
                draft={dirty}
                onOrganize={editor.organize}
                onNavigate={editor.navigate}
                disabledReason={
                  !online
                    ? 'Moteur déconnecté.'
                    : !shortcutsActive
                      ? 'Raccourcis désactivé.'
                      : undefined
                }
                onSelect={(index) => select({ kind: 'key', index })}
                onSnapshot={acceptSnapshot}
                empty=<span className="empty-key">
                  <Icon name="plus" size={22} />
                </span>
                interactive={online && !dirty && !editor.busy}
              />
            ) : (
              <div className="key-grid loading" aria-label="Chargement des touches">
                {Array.from({ length: 36 }, (_, index) => (
                  <button key={index} className="deck-key" disabled={true}>
                    <span className="empty-key">
                      <Icon name="plus" size={22} />
                    </span>
                  </button>
                ))}
              </div>
            )}
            {(snapshot?.lcds ?? [{ index: 0, revision: 0, width: 1200, height: 100 }]).map(
              (lcd) => (
                <div
                  key={lcd.index}
                  className="lcd-strip"
                  style={{ aspectRatio: `${lcd.width}/${lcd.height}` }}
                  aria-label="Écran LCD du mixer audio"
                >
                  {lcd.revision ? (
                    <img
                      src={`/api/image/lcd/${lcd.index}?session=${snapshot?.sessionId}&revision=${lcd.revision}`}
                      alt="Affichage actuel du mixer et des cartes des applications"
                      draggable={false}
                    />
                  ) : null}
                  {(lcd.index === 0 ? (snapshot?.dials ?? []) : [])
                    .filter((dial) => dial.interaction)
                    .map((dial) => (
                      <button
                        key={dial.index}
                        className="lcd-card-hit"
                        style={{
                          left: `${(dial.x / lcd.width) * 100}%`,
                          width: `${(dial.cardWidth / lcd.width) * 100}%`,
                        }}
                        title={`${dial.name} · ${dial.interaction}`}
                        aria-label={`${dial.name} · ${dial.interaction}`}
                        disabled={!online || !mixerActive}
                        onClick={() => currentTapLcd(dial)}
                      />
                    ))}
                </div>
              ),
            )}
            <div className="dial-row">
              {(
                snapshot?.dials ??
                Array.from({ length: 6 }, (_, index) => ({
                  index,
                  master: index === 5,
                  name: null,
                  pressed: false,
                  rotationSteps: 0,
                  key: null,
                  interaction: null,
                  cardWidth: 200,
                  volume: null,
                  muted: false,
                  x: index * 200,
                  width: 200,
                }))
              ).map((dial) => (
                <DialControl
                  key={dial.index}
                  dial={dial}
                  lcdWidth={snapshot?.lcds[0]?.width ?? 1200}
                  selected={selection.kind === 'dial' && selection.index === dial.index}
                  disabled={!snapshot || !online}
                  page={snapshot?.page ?? 0}
                  sessionId={snapshot?.sessionId ?? ''}
                  onSnapshot={acceptSnapshot}
                  onError={(cause) =>
                    setError(cause instanceof Error ? cause.message : 'Le réglage a échoué.')
                  }
                  onSelect={(index) => select({ kind: 'dial', index })}
                />
              ))}
            </div>
          </div>
          <div className="preview-footer">
            <span>{online ? 'Aperçu en direct' : 'Reconnexion au moteur…'}</span>
            <div className="pagination">
              <button
                aria-label="Applications précédentes"
                disabled={!online || (snapshot?.pages ?? 1) < 2}
                onClick={() => turnPage(-1)}
              >
                <Icon name="left" size={17} />
              </button>
              <span>{`${(snapshot?.page ?? 0) + 1} / ${snapshot?.pages ?? 1}`}</span>
              <button
                aria-label="Applications suivantes"
                disabled={!online || (snapshot?.pages ?? 1) < 2}
                onClick={() => turnPage(1)}
              >
                <Icon name="right" size={17} />
              </button>
            </div>
          </div>
          {snapshot ? (
            <LayoutControls
              snapshot={invariant(snapshot, 'editor-snapshot')}
              selected={selectedKey}
              online={online && shortcutsActive}
              locked={editor.busy}
              onOrganize={editor.organize}
              onNavigate={editor.navigate}
            />
          ) : null}
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
        </section>
        <EditorTabs
          selected={tab}
          onSelect={setTab}
          plugins={
            snapshot ? (
              <PluginControls
                snapshot={snapshot}
                online={online}
                dirty={dirty}
                locked={editor.busy}
                catalogue={catalogue}
                tileTarget={
                  selectedKey &&
                  shortcutsActive &&
                  !selectedKey.navigation &&
                  selectedKey.status !== 'running'
                    ? selectedKey.index
                    : null
                }
                onChooseTile={chooseTile}
                onDropTile={chooseTile}
                onTileTarget={setTileTarget}
                onSnapshot={acceptSnapshot}
              />
            ) : (
              <p className="field-hint" role="status">
                Chargement des plugins…
              </p>
            )
          }
        >
          {selectedKey && !shortcutsActive ? (
            <section className="inspector">
              <h2>{`Touche ${selectedKey.index + 1}`}</h2>
              <p className="inspector-intro">
                {snapshot?.plugins.items.some(
                  (plugin) => plugin.enabled && plugin.keys.includes(selectedKey.index),
                )
                  ? `Cette touche est pilotée par ${
                      invariant(
                        snapshot.plugins.items.find(
                          (plugin) => plugin.enabled && plugin.keys.includes(selectedKey.index),
                        ),
                        'app',
                      ).name
                    }. Désactive ce plugin avant de lui affecter un raccourci.`
                  : 'Le plugin Raccourcis est désactivé. Active-le dans l’onglet Plugins pour configurer et utiliser les touches.'}
              </p>
            </section>
          ) : selectedDial && !mixerActive ? (
            <section className="inspector">
              <h2>{`Potard ${selectedDial.index + 1}`}</h2>
              <p className="inspector-intro">
                Le mixer audio est désactivé. Ce potard est disponible pour un autre plugin.
              </p>
            </section>
          ) : selectedKey && catalogue ? (
            <KeyInspector
              key={selectedKey.index}
              selected={selectedKey}
              catalogue={catalogue}
              snapshot={invariant(snapshot, 'editor-snapshot')}
              online={online}
              onSnapshot={acceptSnapshot}
              draft={editor.form(selectedKey) ?? draftOf(selectedKey.binding, catalogue)}
              onDraft={(draft) => editor.edit(selectedKey, draft)}
              onOrganize={editor.organize}
              onNavigate={editor.navigate}
              dirty={dirty}
              busy={editor.busy}
            />
          ) : selectedDial ? (
            <section className="inspector dial-inspector">
              <h2>{selectedDial.master ? 'Master' : `Potard ${selectedDial.index + 1}`}</h2>
              <p className="inspector-intro">Mixer audio</p>
              <div className="dial-assignment">
                <h3>{selectedDial.name ?? 'Aucune application'}</h3>
                <p>
                  {selectedDial.volume === null
                    ? 'Ce potard est libre sur cette page.'
                    : `${Math.round(selectedDial.volume)} %${selectedDial.muted ? ' · Son coupé' : ''}`}
                </p>
              </div>
              <dl className="behaviors">
                <dt>Rotation</dt>
                <dd>Volume de la source affichée</dd>
                <dt>Appui</dt>
                <dd>Couper ou rétablir le son</dd>
              </dl>
            </section>
          ) : (
            <section className="inspector skeleton" aria-label="Chargement de l’inspecteur">
              <div />
              <div />
              <div />
            </section>
          )}
        </EditorTabs>
      </main>
    </div>
  );
}
createRoot(invariant(document.querySelector('#root'), 'editor-root')).render(<App />);
