import { createElement as h, useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../src/studio-contract.ts';
import * as Api from './api.ts';

/** Serialize press/release requests so a quick release cannot overtake its press. */
export function HeldAction({ keyIndex, address, disabled, onSnapshot, onError }: {
  keyIndex: number; address: string; disabled: boolean;
  onSnapshot: (snapshot: Snapshot) => void; onError: (error: unknown) => void;
}) {
  const held = useRef(false); const sequence = useRef(Promise.resolve());
  const [pressed, setPressed] = useState(false);
  const change = (pressed: boolean) => {
    if (held.current === pressed) return;
    held.current = pressed; setPressed(pressed);
    sequence.current = sequence.current.then(async () => {
      try { onSnapshot(await Api.run(pressed ? Api.trigger(keyIndex, address) : Api.release(keyIndex, address))); }
      catch (error) { onError(error); }
    });
  };
  useEffect(() => {
    const blur = () => change(false);
    const hidden = () => { if (document.hidden) change(false); };
    window.addEventListener('blur', blur); document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hidden);
      if (held.current) { held.current = false; sequence.current = sequence.current.then(async () => { await Api.run(Api.release(keyIndex, address)).catch(onError); }); }
    };
  }, [keyIndex, address]);
  useEffect(() => { if (disabled) change(false); }, [disabled]);
  return h('button', {
    type: 'button', className: 'test-button', disabled, 'aria-pressed': pressed,
    onPointerDown: (event) => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); change(true); },
    onPointerUp: () => change(false), onPointerCancel: () => change(false), onLostPointerCapture: () => change(false), onBlur: () => change(false),
    onKeyDown: (event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); if (!event.repeat) change(true); } },
    onKeyUp: (event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); change(false); } },
  }, pressed ? 'Relâcher pour arrêter' : 'Maintenir pour tester');
}
