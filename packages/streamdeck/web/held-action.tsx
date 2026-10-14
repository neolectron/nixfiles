import type { Snapshot } from '../src/studio-contract.ts';
import { useKeyInput } from './use-key-input.ts';
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
  const { pressed, handlers } = useKeyInput({
    keyIndex,
    address,
    revision,
    disabled,
    onSnapshot,
    onError,
  });
  return (
    <button
      type="button"
      className="test-button"
      disabled={disabled}
      aria-pressed={pressed}
      {...handlers}
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
