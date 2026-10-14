import { createElement as h, useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../src/studio-contract.ts';
import * as Api from './api.ts';
import { delay, type KeyTrigger } from '../src/key-gestures.ts';

/** Serialize press/release requests so a quick release cannot overtake its press. */
export function HeldAction({ keyIndex, address, revision, disabled, trigger, onSnapshot, onError }: {
  keyIndex: number; address: string; disabled: boolean;
  revision: number;
  trigger?: KeyTrigger;
  onSnapshot: (snapshot: Snapshot) => void; onError: (error: unknown) => void;
}) {
  const held = useRef(false); const sequence = useRef(Promise.resolve());
  const pointer = useRef<number | null>(null); const heldBy = useRef<'pointer' | 'keyboard' | null>(null);
  const [pressed, setPressed] = useState(false);
  const change = (pressed: boolean, cancel = false) => {
    if (held.current === pressed && !cancel) return;
    held.current = pressed; setPressed(pressed);
    sequence.current = sequence.current.then(async () => {
      try { onSnapshot(await Api.run(Api.keyInput(keyIndex, cancel ? 'cancel' : pressed ? 'down' : 'up', address, revision))); }
      catch (error) { onError(error); }
    });
  };
  useEffect(() => {
    const blur = () => { pointer.current = null; heldBy.current = null; change(false, true); };
    const hidden = () => { if (document.hidden) blur(); };
    window.addEventListener('blur', blur); document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hidden);
      held.current = false; sequence.current = sequence.current.then(async () => { await Api.run(Api.keyInput(keyIndex, 'cancel', address, revision)).catch(onError); });
    };
  }, [keyIndex, address, revision]);
  useEffect(() => { if (disabled) { pointer.current = null; heldBy.current = null; change(false, true); } }, [disabled]);
  return h('button', {
    type: 'button', className: 'test-button', disabled, 'aria-pressed': pressed,
    onPointerDown: (event) => { if (event.button !== 0 || !event.isPrimary || heldBy.current) return; pointer.current = event.pointerId; heldBy.current = 'pointer'; event.currentTarget.setPointerCapture(event.pointerId); change(true); },
    onPointerUp: (event) => { if (event.pointerId !== pointer.current) return; pointer.current = null; heldBy.current = null; change(false); },
    onPointerCancel: (event) => { if (event.pointerId !== pointer.current) return; pointer.current = null; heldBy.current = null; change(false, true); },
    onLostPointerCapture: () => { if (pointer.current === null) return; pointer.current = null; heldBy.current = null; change(false, true); },
    onBlur: () => { pointer.current = null; heldBy.current = null; change(false, true); },
    onKeyDown: (event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); if (!event.repeat && !heldBy.current) { heldBy.current = 'keyboard'; change(true); } } },
    onKeyUp: (event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); if (heldBy.current === 'keyboard') { heldBy.current = null; change(false); } } },
  }, pressed ? 'Relâcher' : trigger?.type === 'double-tap' ? 'Deux appuis pour tester' : trigger?.type === 'long-press' ? `Maintenir ${delay(trigger)} ms pour tester` : 'Maintenir pour tester');
}
