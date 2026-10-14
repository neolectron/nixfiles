import { useCallback, useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../src/studio-contract.ts';
import * as Api from './api.ts';
import { delay, type KeyTrigger } from '../src/press-trigger.ts';
/** Serialize press/release requests so a quick release cannot overtake its press. */
export function HeldAction({
  keyIndex,
  address,
  revision,
  disabled,
  trigger,
  onSnapshot,
  onError,
}: {
  keyIndex: number;
  address: string;
  disabled: boolean;
  revision: number;
  trigger?: KeyTrigger;
  onSnapshot: (snapshot: Snapshot) => void;
  onError: (error: unknown) => void;
}) {
  const callbacks = useRef({ onSnapshot, onError });
  callbacks.current = { onSnapshot, onError };
  const held = useRef(false);
  const sequence = useRef(Promise.resolve());
  const pointer = useRef<number | null>(null);
  const heldBy = useRef<'pointer' | 'keyboard' | null>(null);
  const [pressed, setPressed] = useState(false);
  const change = useCallback(
    (currentPressed: boolean, cancel = false) => {
      if (held.current === currentPressed && !cancel) return;
      held.current = currentPressed;
      setPressed(currentPressed);
      sequence.current = sequence.current.then(async () => {
        try {
          callbacks.current.onSnapshot(
            await Api.run(
              Api.keyInput(
                keyIndex,
                cancel ? 'cancel' : currentPressed ? 'down' : 'up',
                address,
                revision,
              ),
            ),
          );
        } catch (error) {
          callbacks.current.onError(error);
        }
        return undefined;
      });
    },
    [keyIndex, address, revision],
  );
  useEffect(() => {
    const blur = () => {
      pointer.current = null;
      heldBy.current = null;
      change(false, true);
    };
    const hidden = () => {
      if (document.hidden) blur();
    };
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', hidden);
      held.current = false;
      sequence.current = sequence.current.then(async () => {
        try {
          await Api.run(Api.keyInput(keyIndex, 'cancel', address, revision));
        } catch (error) {
          callbacks.current.onError(error);
        }
        return undefined;
      });
    };
  }, [keyIndex, address, revision, change]);
  useEffect(() => {
    if (disabled) {
      pointer.current = null;
      heldBy.current = null;
      change(false, true);
    }
  }, [disabled, change]);
  return (
    <button
      type="button"
      className="test-button"
      disabled={disabled}
      aria-pressed={pressed}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary || heldBy.current) return;
        pointer.current = event.pointerId;
        heldBy.current = 'pointer';
        event.currentTarget.setPointerCapture(event.pointerId);
        change(true);
      }}
      onPointerUp={(event) => {
        if (event.pointerId !== pointer.current) return;
        pointer.current = null;
        heldBy.current = null;
        change(false);
      }}
      onPointerCancel={(event) => {
        if (event.pointerId !== pointer.current) return;
        pointer.current = null;
        heldBy.current = null;
        change(false, true);
      }}
      onLostPointerCapture={() => {
        if (pointer.current === null) return;
        pointer.current = null;
        heldBy.current = null;
        change(false, true);
      }}
      onBlur={() => {
        pointer.current = null;
        heldBy.current = null;
        change(false, true);
      }}
      onKeyDown={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          if (!event.repeat && !heldBy.current) {
            heldBy.current = 'keyboard';
            change(true);
          }
        }
      }}
      onKeyUp={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          if (heldBy.current === 'keyboard') {
            heldBy.current = null;
            change(false);
          }
        }
      }}
    >
      {pressed
        ? 'Relâcher'
        : trigger?.type === 'double-tap'
          ? 'Deux appuis pour tester'
          : trigger?.type === 'long-press'
            ? `Maintenir ${delay(trigger)} ms pour tester`
            : 'Maintenir pour tester'}
    </button>
  );
}
