import { useRef, type KeyboardEvent, type ReactNode } from 'react';

/** Keep panels mounted to preserve drafts, with one keyboard stop per tab group. */
export function Tabs<Value extends string>({
  id,
  label,
  selected,
  onSelect,
  items,
  className = 'editor-tabs',
}: {
  readonly id: string;
  readonly label: string;
  readonly selected: Value;
  readonly onSelect: (value: Value) => void;
  readonly items: ReadonlyArray<{
    readonly id: Value;
    readonly label: string;
    readonly content: ReactNode;
  }>;
  readonly className?: string;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % items.length
        : event.key === 'ArrowLeft'
          ? (index + items.length - 1) % items.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    const item = items[next];
    if (item) onSelect(item.id);
    buttons.current[next]?.focus();
  };
  return (
    <>
      <div className={className} role="tablist" aria-label={label}>
        {items.map((item, index) => (
          <button
            key={item.id}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            id={`${id}-tab-${item.id}`}
            role="tab"
            type="button"
            aria-selected={selected === item.id}
            aria-controls={`${id}-panel-${item.id}`}
            tabIndex={selected === item.id ? 0 : -1}
            onClick={() => onSelect(item.id)}
            onKeyDown={(event) => navigate(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          id={`${id}-panel-${item.id}`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${item.id}`}
          hidden={selected !== item.id}
        >
          {item.content}
        </div>
      ))}
    </>
  );
}
