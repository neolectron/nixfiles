import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes } from 'react';
import type { Snapshot } from '../src/studio-contract.ts';
import * as Api from './api.ts';
/** Only adapt DOM press/release; timing and semantic gestures stay in the Effect library. */
export function useKeyInput({
  keyIndex,
  address,
  revision,
  disabled,
  onSnapshot,
  onError,
}: {
  keyIndex: number;
  address: string;
  revision: number;
  disabled: boolean;
  onSnapshot: (snapshot: Snapshot) => void;
  onError: (error: unknown) => void;
}) {
  const callbacks = useRef({ onSnapshot, onError });
  callbacks.current = { onSnapshot, onError };
  const [owner] = useState(() => crypto.randomUUID());
  const touched = useRef(false);
  const held = useRef(false);
  const sequence = useRef(Promise.resolve());
  const pointer = useRef<number | null>(null);
  const heldBy = useRef<'pointer' | 'keyboard' | null>(null);
  const [pressed, setPressed] = useState(false);
  const change = useCallback(
    (currentPressed: boolean, cancel = false) => {
      if (held.current === currentPressed && !cancel) return;
      if (cancel && !touched.current) return;
      touched.current = !cancel;
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
                owner,
              ),
            ),
          );
        } catch (error) {
          callbacks.current.onError(error);
        }
        return undefined;
      });
    },
    [keyIndex, address, revision, owner],
  );
  useEffect(() => {
    const capturedOwner = owner;
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
      if (!touched.current) return;
      touched.current = false;
      held.current = false;
      pointer.current = null;
      heldBy.current = null;
      setPressed(false);
      sequence.current = sequence.current.then(async () => {
        try {
          await Api.run(Api.keyInput(keyIndex, 'cancel', address, revision, capturedOwner));
        } catch (error) {
          callbacks.current.onError(error);
        }
        return undefined;
      });
    };
  }, [keyIndex, address, revision, change, owner]);
  useEffect(() => {
    if (disabled) {
      pointer.current = null;
      heldBy.current = null;
      change(false, true);
    }
  }, [disabled, change]);
  const handlers: ButtonHTMLAttributes<HTMLButtonElement> = {
    onPointerDown: (event) => {
      if (disabled || event.button !== 0 || !event.isPrimary || heldBy.current) return;
      pointer.current = event.pointerId;
      heldBy.current = 'pointer';
      event.currentTarget.setPointerCapture(event.pointerId);
      change(true);
    },
    onPointerUp: (event) => {
      if (event.pointerId !== pointer.current) return;
      pointer.current = null;
      heldBy.current = null;
      change(false);
    },
    onPointerCancel: (event) => {
      if (event.pointerId !== pointer.current) return;
      pointer.current = null;
      heldBy.current = null;
      change(false, true);
    },
    onLostPointerCapture: () => {
      if (pointer.current === null) return;
      pointer.current = null;
      heldBy.current = null;
      change(false, true);
    },
    onBlur: () => {
      pointer.current = null;
      heldBy.current = null;
      change(false, true);
    },
    onKeyDown: (event) => {
      if (!disabled && (event.key === ' ' || event.key === 'Enter')) {
        event.preventDefault();
        if (!event.repeat && !heldBy.current) {
          heldBy.current = 'keyboard';
          change(true);
        }
      }
    },
    onKeyUp: (event) => {
      if (!disabled && (event.key === ' ' || event.key === 'Enter')) {
        event.preventDefault();
        if (heldBy.current === 'keyboard') {
          heldBy.current = null;
          change(false);
        }
      }
    },
  };
  return {
    pressed,
    handlers,
    cancel: () => {
      pointer.current = null;
      heldBy.current = null;
      change(false, true);
    },
  };
}
