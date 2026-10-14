import { invariant } from '../src/errors.ts';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Snapshot } from '../src/studio-contract.ts';
import * as Api from './api.ts';
type Key = Snapshot['keys'][number];
type Gesture = {
  key: Key;
  revision: number;
  session: string;
};
const movable = (key: Key) => !key.navigation && key.status !== 'running' && !key.pressed;
/** Native browser drag/drop, plus Alt + arrow keys. Selection never executes a shortcut. */
export function KeyGrid({
  snapshot,
  selected,
  editable,
  disabledReason,
  onSelect,
  onSnapshot,
  onNavigate,
  empty,
}: {
  snapshot: Snapshot;
  selected: number | null;
  editable: boolean;
  disabledReason: string | undefined;
  empty: ReactNode;
  onSelect: (index: number) => void;
  onSnapshot: (snapshot: Snapshot) => void;
  onNavigate: (key: Key) => void;
}) {
  const drag = useRef<Gesture | null>(null);
  const saving = useRef(false);
  const [source, setSource] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const clear = () => {
    drag.current = null;
    setSource(null);
    setTarget(null);
  };
  useEffect(() => {
    const cancel = () => clear();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clear();
    };
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', escape);
    };
  }, []);
  useEffect(() => {
    clear();
  }, [snapshot.sessionId, snapshot.layout.revision, editable]);
  const allowed = editable && !busy;
  const gesture = (key: Key): Gesture => ({
    key,
    revision: snapshot.layout.revision,
    session: snapshot.sessionId,
  });
  const exchange = async (from: Gesture, to: Key) => {
    clear();
    if (saving.current || !editable || !movable(to) || from.key.index === to.index) return;
    if (from.session !== snapshot.sessionId) {
      setError('Le moteur a redémarré. Recommence le déplacement.');
      return;
    }
    saving.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const next = await Api.run(
        Api.organize({
          operation: 'exchange',
          source: from.key.index,
          target: to.index,
          sourceAddress: from.key.address,
          targetAddress: to.address,
          revision: from.revision,
        }),
      );
      onSnapshot(next);
      onSelect(to.index);
      setNotice(
        `« ${invariant(from.key.binding, 'key-grid').label} » déplacé vers la touche ${to.index + 1}.`,
      );
      document.querySelector<HTMLButtonElement>(`[data-deck-key="${to.index}"]`)?.focus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Le déplacement a échoué. Réessaie.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="key-arrangement">
      <div className="key-grid" aria-label="Touches" aria-busy={busy}>
        {snapshot.keys.map((key) => (
          <button
            key={key.index}
            data-deck-key={key.index}
            className={`deck-key${selected === key.index ? ' selected' : ''}${key.pressed ? ' pressed' : ''}${source === key.index ? ' dragging' : ''}${target === key.index ? ' drop-target' : ''}`}
            aria-label={`Touche ${key.index + 1} · ${key.binding?.label ?? snapshot.plugins.items.find((plugin) => plugin.id !== 'shortcuts' && plugin.enabled && plugin.keys.includes(key.index))?.name ?? 'libre'}`}
            aria-pressed={selected === key.index}
            aria-describedby="rearrange-help"
            draggable={allowed && movable(key) && !!key.binding}
            onClick={() => {
              if (!saving.current && !drag.current) onSelect(key.index);
            }}
            onDoubleClick={() => {
              if (allowed && !drag.current) onNavigate(key);
            }}
            onDragStart={(event) => {
              if (!allowed || !movable(key) || !key.binding) {
                event.preventDefault();
                return;
              }
              drag.current = gesture(key);
              setSource(key.index);
              setError('');
              setNotice('');
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('application/x-streamdeck-key', String(key.index));
            }}
            onDragEnd={clear}
            onDragOver={(event) => {
              if (
                !allowed ||
                !drag.current ||
                !movable(key) ||
                drag.current.key.index === key.index
              )
                return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setTarget(key.index);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                setTarget((previous) => (previous === key.index ? null : previous));
            }}
            onDrop={(event) => {
              const from = drag.current;
              if (!from) return;
              event.preventDefault();
              void exchange(from, key);
            }}
            onKeyDown={(event) => {
              if (
                !allowed ||
                !movable(key) ||
                !key.binding ||
                !event.altKey ||
                event.ctrlKey ||
                event.metaKey ||
                event.shiftKey
              )
                return;
              const offset = {
                ArrowLeft: [0, -1],
                ArrowRight: [0, 1],
                ArrowUp: [-1, 0],
                ArrowDown: [1, 0],
              }[event.key];
              if (!offset) return;
              event.preventDefault();
              const to = snapshot.keys.find(
                (item) =>
                  item.row === key.row + invariant(offset[0], 'key-grid') &&
                  item.column === key.column + invariant(offset[1], 'key-grid'),
              );
              if (to) void exchange(gesture(key), to);
            }}
          >
            {key.revision ? (
              <img
                src={`/api/image/key/${key.index}?session=${snapshot.sessionId}&revision=${key.revision}`}
                alt=""
                draggable={false}
              />
            ) : (
              empty
            )}
            <span className="key-number">{key.index + 1}</span>
          </button>
        ))}
      </div>
      <p id="rearrange-help" className="rearrange-help">
        {disabledReason ??
          'Glisse une touche pour la déplacer. Une case occupée échange les raccourcis. Au clavier : Alt + flèches.'}
      </p>
      {busy || notice ? (
        <p className="rearrange-status" role="status">
          {busy ? 'Enregistrement du déplacement…' : notice}
        </p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
