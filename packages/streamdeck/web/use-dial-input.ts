import { useEffect, useRef, type ButtonHTMLAttributes } from 'react';
import type { Snapshot } from '../src/studio-contract.ts';
import * as Api from './api.ts';

/** DOM displacement produces encoder cranks; plugin routing and audio remain in Effect. */
export function useDialInput({
  dial,
  page,
  sessionId,
  disabled,
  onSnapshot,
  onError,
  onSelect,
}: {
  dial: Snapshot['dials'][number];
  page: number;
  sessionId: string;
  disabled: boolean;
  onSnapshot: (snapshot: Snapshot) => void;
  onError: (error: unknown) => void;
  onSelect: (index: number) => void;
}) {
  const element = useRef<HTMLButtonElement>(null);
  const callbacks = useRef({ onSnapshot, onError, onSelect });
  callbacks.current = { onSnapshot, onError, onSelect };
  const queue = useRef(Promise.resolve());
  const pointer = useRef<{
    id: number;
    x: number;
    steps: number;
    moved: boolean;
    turn: (delta: number) => void;
  } | null>(null);
  const suppressClick = useRef(false);
  const wheelRemainder = useRef(0);
  const identity = JSON.stringify([
    sessionId,
    dial.index,
    dial.key,
    dial.master ? null : page,
    disabled,
  ]);
  const latestIdentity = useRef(identity);
  latestIdentity.current = identity;
  const turn = (delta: number) => {
    while (delta !== 0) {
      const steps = Math.max(-20, Math.min(20, delta));
      const input = { dial: dial.index, delta: steps, application: dial.key, page, sessionId };
      queue.current = queue.current.then(async () => {
        if (latestIdentity.current !== identity) return undefined;
        try {
          callbacks.current.onSnapshot(await Api.run(Api.dialInput(input)));
        } catch (error) {
          callbacks.current.onError(error);
        }
        return undefined;
      });
      delta -= steps;
    }
  };
  const latestTurn = useRef(turn);
  latestTurn.current = turn;
  useEffect(
    () => () => {
      latestIdentity.current = '';
      pointer.current = null;
    },
    [],
  );
  useEffect(() => {
    pointer.current = null;
    wheelRemainder.current = 0;
  }, [dial.index, dial.key, page, sessionId, disabled]);
  useEffect(() => {
    const button = element.current;
    if (!button || disabled) return;
    const wheel = (event: WheelEvent) => {
      if (!event.deltaX && !event.deltaY) return;
      event.preventDefault();
      const displacement =
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : -event.deltaY;
      const pixels = displacement * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 200 : 1);
      wheelRemainder.current += pixels;
      const steps = Math.trunc(wheelRemainder.current / 40);
      if (steps) {
        wheelRemainder.current -= steps * 40;
        latestTurn.current(steps);
      }
    };
    button.addEventListener('wheel', wheel, { passive: false });
    return () => button.removeEventListener('wheel', wheel);
  }, [disabled]);
  const finish = () => {
    if (pointer.current?.moved) suppressClick.current = true;
    pointer.current = null;
  };
  const handlers: ButtonHTMLAttributes<HTMLButtonElement> = {
    onPointerDown: (event) => {
      if (disabled || event.button !== 0 || !event.isPrimary) return;
      suppressClick.current = false;
      event.currentTarget.setPointerCapture(event.pointerId);
      pointer.current = { id: event.pointerId, x: event.clientX, steps: 0, moved: false, turn };
    },
    onPointerMove: (event) => {
      const current = pointer.current;
      if (!current || current.id !== event.pointerId) return;
      const steps = Math.trunc((event.clientX - current.x) / 6);
      const delta = steps - current.steps;
      if (!delta) return;
      current.steps = steps;
      current.moved = true;
      current.turn(delta);
    },
    onPointerUp: finish,
    onPointerCancel: finish,
    onLostPointerCapture: finish,
    onBlur: finish,
    onClick: () => {
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      callbacks.current.onSelect(dial.index);
    },
    onKeyDown: (event) => {
      if (!disabled && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        turn(event.key === 'ArrowRight' ? 1 : -1);
      }
    },
  };
  return { element, handlers };
}
