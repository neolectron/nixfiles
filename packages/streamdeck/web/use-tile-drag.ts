import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';

const underPointer = (event: PointerEvent<HTMLButtonElement>) => {
  const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-deck-slot]');
  const slot = cell?.getAttribute('data-deck-slot');
  return cell?.getAttribute('data-tile-drop-allowed') === 'true' &&
    slot !== null &&
    slot !== undefined
    ? Number(slot)
    : null;
};

/** Palette dragging prepares a key draft; it never sends a physical press or saves a binding. */
export function useTileDrag({
  disabled,
  onDrop,
  onTarget,
}: {
  readonly disabled: boolean;
  readonly onDrop: (index: number) => void;
  readonly onTarget: (index: number | null) => void;
}) {
  const pointer = useRef<{ id: number; x: number; y: number; moving: boolean } | null>(null);
  // Keep this through pointer-up/cancellation: browsers can emit a click after a drag.
  const suppressClick = useRef(false);
  const callbacks = useRef({ onDrop, onTarget });
  callbacks.current = { onDrop, onTarget };
  const target = useRef<number | null>(null);
  const [preview, setPreview] = useState<{ x: number; y: number } | null>(null);
  const hover = (index: number | null) => {
    if (target.current === index) return;
    target.current = index;
    callbacks.current.onTarget(index);
  };
  const clear = () => {
    pointer.current = null;
    setPreview(null);
    hover(null);
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
      if (target.current !== null) callbacks.current.onTarget(null);
    };
  }, []);
  useEffect(() => {
    if (disabled) clear();
  }, [disabled]);
  return {
    preview,
    handlers: {
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
        if (disabled || event.button !== 0 || !event.isPrimary) return;
        suppressClick.current = false;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        pointer.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          moving: false,
        };
      },
      onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
        const current = pointer.current;
        if (!current || current.id !== event.pointerId) return;
        if (!current.moving && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6)
          return;
        current.moving = true;
        suppressClick.current = true;
        setPreview({ x: event.clientX, y: event.clientY });
        hover(underPointer(event));
      },
      onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
        const current = pointer.current;
        const index = underPointer(event);
        clear();
        if (!disabled && current?.id === event.pointerId && current.moving && index !== null)
          callbacks.current.onDrop(index);
      },
      onPointerCancel: clear,
      onLostPointerCapture: clear,
      onClickCapture: (event: MouseEvent<HTMLButtonElement>) => {
        if (!suppressClick.current || event.detail === 0) return;
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      },
    },
  };
}
