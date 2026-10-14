import { invariant } from '../src/errors.ts';
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type HTMLAttributes,
  type PointerEvent,
} from 'react';
import type { Snapshot, Organize, Navigate } from '../src/studio-contract.ts';
import * as Api from './api.ts';
import { KeyCard } from '../src/ui/key-card.tsx';
import { Effect } from 'effect';
import { useKeyInput } from './use-key-input.ts';
import { DragGrip } from './drag-grip.tsx';
type Key = Snapshot['keys'][number];
type Gesture = {
  key: Key;
  revision: number;
  session: string;
};
const movable = (key: Key) =>
  !key.overlay && !key.navigation && key.status !== 'running' && !key.pressed;
const draftNavigation = (key: Key): Navigate | null => {
  const binding = key.binding;
  if (!binding) return null;
  if (binding.action === 'go-back') return { zone: key.zone, operation: 'back' };
  if (
    binding.action !== 'open-folder' &&
    binding.action !== 'page-next' &&
    binding.action !== 'page-previous'
  )
    return null;
  const target = binding.parameters.target ?? 'current';
  if (target === 'audio') return null;
  const zone = target === 'current' ? key.zone : target;
  return binding.action === 'open-folder'
    ? { zone, operation: 'open', folder: binding.parameters.folder }
    : { zone, operation: binding.action === 'page-next' ? 'next' : 'previous' };
};

/** Action and editing are sibling controls: editing can never bubble into a plugin press. */
function DeckCell({
  snapshot,
  deckKey,
  selected,
  disabled,
  onSelect,
  onSnapshot,
  onError,
  cellProps,
  dragHandle,
  dragHandlers,
  children,
  onDraftNavigate,
}: {
  snapshot: Snapshot;
  deckKey: Key;
  selected: boolean;
  disabled: boolean;
  onSelect: (index: number) => void;
  onSnapshot: (snapshot: Snapshot) => void;
  onError: (error: unknown) => void;
  cellProps: HTMLAttributes<HTMLDivElement> & {
    'data-deck-slot': number;
    'data-tile-drop-allowed': string;
  };
  dragHandlers: HTMLAttributes<HTMLButtonElement>;
  dragHandle: boolean;
  children: ReactNode;
  onDraftNavigate?: () => void;
}) {
  const { pressed, handlers, cancel } = useKeyInput({
    keyIndex: deckKey.index,
    address: deckKey.address,
    revision: snapshot.layout.revision,
    disabled,
    onSnapshot,
    onError,
  });
  const edit = () => {
    cancel();
    onSelect(deckKey.index);
  };
  return (
    <div
      {...cellProps}
      className={`${cellProps.className ?? ''}${pressed ? ' pressed' : ''}`}
      onContextMenu={(event) => {
        event.preventDefault();
        edit();
      }}
    >
      <button
        type="button"
        className="deck-key-action"
        data-deck-key={deckKey.index}
        aria-label={`Touche ${deckKey.index + 1} · ${deckKey.binding?.label ?? snapshot.plugins.items.find((plugin) => plugin.id !== 'shortcuts' && plugin.enabled && plugin.keys.includes(deckKey.index))?.name ?? 'libre'}`}
        aria-pressed={pressed || deckKey.pressed}
        disabled={disabled && !onDraftNavigate}
        {...(onDraftNavigate ? { onClick: onDraftNavigate } : handlers)}
      >
        {children}
      </button>
      {dragHandle ? (
        <button
          type="button"
          className="key-number key-drag-handle"
          {...dragHandlers}
          aria-label={`Déplacer la touche ${deckKey.index + 1} · ${deckKey.binding?.label ?? ''}`}
          title="Glisser pour déplacer · Alt + flèches au clavier"
          onPointerDown={(event) => {
            cancel();
            dragHandlers.onPointerDown?.(event);
          }}
        >
          <DragGrip />
          <span>{deckKey.index + 1}</span>
        </button>
      ) : (
        <span className="key-number">{deckKey.index + 1}</span>
      )}
      <button
        type="button"
        className="key-edit"
        aria-label={`Modifier la touche ${deckKey.index + 1}`}
        aria-pressed={selected}
        onPointerDown={(event) => {
          event.stopPropagation();
          cancel();
        }}
        onClick={edit}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m16 3 5 5L8 21H3v-5L16 3Zm-3 3 5 5" />
        </svg>
      </button>
    </div>
  );
}
/** Pointer drag from a dedicated handle, plus Alt + arrow keys. Left presses use plugin gestures; pencil/context menu edit. */
export function KeyGrid({
  snapshot,
  selected,
  editable,
  disabledReason,
  onSelect,
  onSnapshot,
  interactive,
  empty,
  tileTarget = null,
  draft = false,
  onOrganize,
  onNavigate,
}: {
  snapshot: Snapshot;
  selected: number | null;
  editable: boolean;
  disabledReason: string | undefined;
  empty: ReactNode;
  onSelect: (index: number) => void;
  onSnapshot: (snapshot: Snapshot) => void;
  interactive: boolean;
  tileTarget?: number | null;
  draft?: boolean;
  onOrganize: (command: Organize) => Effect.Effect<Snapshot, unknown>;
  onNavigate: (command: Navigate) => Effect.Effect<Snapshot, unknown>;
}) {
  const drag = useRef<Gesture | null>(null);
  const pointerDrag = useRef<{ id: number; x: number; y: number; moving: boolean } | null>(null);
  const saving = useRef(false);
  const [source, setSource] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const clear = () => {
    drag.current = null;
    pointerDrag.current = null;
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
  const underPointer = (event: PointerEvent<HTMLButtonElement>) => {
    const slot = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest('[data-deck-slot]')
      ?.getAttribute('data-deck-slot');
    return slot === null || slot === undefined
      ? undefined
      : snapshot.keys.find((key) => key.index === Number(slot));
  };
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
      await Api.run(
        onOrganize({
          operation: 'exchange',
          source: from.key.index,
          target: to.index,
          sourceAddress: from.key.address,
          targetAddress: to.address,
          revision: from.revision,
        }),
      );

      onSelect(to.index);
      setNotice(
        `« ${invariant(from.key.binding, 'key-grid').label} » déplacé vers la touche ${to.index + 1} dans le brouillon.`,
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
      <div className="key-grid-scroll">
        <div className="key-grid" aria-label="Touches" aria-busy={busy}>
          {snapshot.keys.map((key) => (
            <DeckCell
              key={`${snapshot.sessionId}/${key.index}`}
              snapshot={snapshot}
              deckKey={key}
              selected={selected === key.index}
              disabled={!interactive || busy}
              onSelect={onSelect}
              onSnapshot={onSnapshot}
              onError={(cause) =>
                setError(cause instanceof Error ? cause.message : 'L’action a échoué.')
              }
              {...(draft && allowed && draftNavigation(key)
                ? {
                    onDraftNavigate: () => {
                      void Api.run(onNavigate(invariant(draftNavigation(key), 'key-grid'))).catch(
                        (cause) =>
                          setError(
                            cause instanceof Error ? cause.message : 'La navigation a échoué.',
                          ),
                      );
                    },
                  }
                : {})}
              dragHandle={allowed && movable(key) && !!key.binding}
              dragHandlers={{
                onPointerDown: (event) => {
                  if (
                    !allowed ||
                    !movable(key) ||
                    !key.binding ||
                    event.button !== 0 ||
                    !event.isPrimary
                  )
                    return;
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  drag.current = gesture(key);
                  pointerDrag.current = {
                    id: event.pointerId,
                    x: event.clientX,
                    y: event.clientY,
                    moving: false,
                  };
                  setError('');
                  setNotice('');
                },
                onPointerMove: (event) => {
                  const current = pointerDrag.current;
                  if (!current || current.id !== event.pointerId || !drag.current) return;
                  if (
                    !current.moving &&
                    Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6
                  )
                    return;
                  current.moving = true;
                  setSource(drag.current.key.index);
                  const to = underPointer(event);
                  setTarget(
                    to && movable(to) && to.index !== drag.current.key.index ? to.index : null,
                  );
                },
                onPointerUp: (event) => {
                  const current = pointerDrag.current;
                  const from = drag.current;
                  const to = underPointer(event);
                  if (current?.id === event.pointerId && current.moving && from && to)
                    void exchange(from, to);
                  else clear();
                },
                onPointerCancel: clear,
                onLostPointerCapture: clear,
              }}
              cellProps={{
                'data-deck-slot': key.index,
                'data-tile-drop-allowed': allowed && movable(key) ? 'true' : 'false',
                className: `deck-key${selected === key.index ? ' selected' : ''}${key.pressed ? ' pressed' : ''}${source === key.index ? ' dragging' : ''}${target === key.index || tileTarget === key.index ? ' drop-target' : ''}`,
                onKeyDown: (event) => {
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
                },
              }}
            >
              {draft && key.binding ? (
                <svg width="100%" height="100%" viewBox="0 0 100 100" aria-hidden={true}>
                  <foreignObject width={100} height={100}>
                    <KeyCard
                      width={100}
                      height={100}
                      label={key.binding.label}
                      action={key.binding.action}
                      count={key.count}
                      status={key.status}
                      feedback={key.feedback}
                    />
                  </foreignObject>
                </svg>
              ) : !draft && key.revision ? (
                <img
                  src={`/api/image/key/${key.index}?session=${snapshot.sessionId}&revision=${key.revision}`}
                  alt=""
                  draggable={false}
                />
              ) : (
                empty
              )}
            </DeckCell>
          ))}
        </div>
      </div>
      {disabledReason ? (
        <p className="rearrange-status" role="status">
          {disabledReason}
        </p>
      ) : null}
      {busy || notice ? (
        <p className="rearrange-status" role="status">
          {busy ? 'Préparation du déplacement…' : notice}
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
