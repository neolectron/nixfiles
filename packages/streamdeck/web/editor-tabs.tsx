import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export type EditorTab = 'edit' | 'plugins';
const tabs = [
  { id: 'edit', label: 'Édition' },
  { id: 'plugins', label: 'Plugins' },
] as const;

/** Panels stay mounted so changing tabs never discards an unsaved key or connection draft. */
export function EditorTabs({
  selected,
  onSelect,
  children,
  plugins,
}: {
  readonly selected: EditorTab;
  readonly onSelect: (tab: EditorTab) => void;
  readonly children: ReactNode;
  readonly plugins: ReactNode;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index + tabs.length - 1) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    onSelect(tabs[next]?.id ?? 'edit');
    buttons.current[next]?.focus();
  };
  return (
    <aside className="editor-sidebar" aria-label="Configuration du deck">
      <div className="editor-tabs" role="tablist" aria-label="Configuration">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            id={`editor-tab-${tab.id}`}
            role="tab"
            type="button"
            aria-selected={selected === tab.id}
            aria-controls={`editor-panel-${tab.id}`}
            tabIndex={selected === tab.id ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => navigate(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        id="editor-panel-edit"
        role="tabpanel"
        aria-labelledby="editor-tab-edit"
        hidden={selected !== 'edit'}
      >
        {children}
      </div>
      <div
        id="editor-panel-plugins"
        role="tabpanel"
        aria-labelledby="editor-tab-plugins"
        hidden={selected !== 'plugins'}
      >
        {plugins}
      </div>
    </aside>
  );
}
