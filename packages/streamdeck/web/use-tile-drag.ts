import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';

export type DropTarget =
  | { readonly kind: 'key'; readonly index: number }
  | { readonly kind: 'lcd'; readonly index: number; readonly x: number };
const underPointer = (
  event: PointerEvent<HTMLButtonElement>,
  key: boolean,
  lcd: boolean,
): DropTarget | null => {
  const element = document.elementFromPoint(event.clientX, event.clientY);
  const strip = element?.closest('[data-lcd-slot]');
  if (lcd && strip?.getAttribute('data-lcd-drop-allowed') === 'true') {
    const rect = strip.getBoundingClientRect();
    return {
      kind: 'lcd',
      index: Number(strip.getAttribute('data-lcd-slot')),
      x: Math.round(
        ((event.clientX - rect.left) / rect.width) * Number(strip.getAttribute('data-lcd-width')),
      ),
    };
  }
  const cell = element?.closest('[data-deck-slot]');
  const slot = cell?.getAttribute('data-deck-slot');
  return key &&
    cell?.getAttribute('data-tile-drop-allowed') === 'true' &&
    slot !== null &&
    slot !== undefined
    ? { kind: 'key', index: Number(slot) }
    : null;
};

/** Palette dragging prepares a key draft; it never sends a physical press or saves a binding. */
export function useTileDrag({
  disabled,
  onDrop,
  onTarget,
  key = true,
  lcd = true,
}: {
  readonly disabled: boolean;
  readonly onDrop: (target: DropTarget) => void;
  readonly onTarget: (target: DropTarget | null) => void;
  readonly key?: boolean;
  readonly lcd?: boolean;
}) {
  const pointer = useRef<{ id: number; x: number; y: number; moving: boolean } | null>(null);
  // Keep this through pointer-up/cancellation: browsers can emit a click after a drag.
  const suppressClick = useRef(false);
  const callbacks = useRef({ onDrop, onTarget });
  callbacks.current = { onDrop, onTarget };
  const target = useRef<DropTarget | null>(null);
  const [preview, setPreview] = useState<{ x: number; y: number } | null>(null);
  const hover = (index: DropTarget | null) => {
    if (JSON.stringify(target.current) === JSON.stringify(index)) return;
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
        hover(underPointer(event, key, lcd));
      },
      onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
        const current = pointer.current;
        const index = underPointer(event, key, lcd);
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
