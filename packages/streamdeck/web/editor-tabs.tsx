import type { ReactNode } from 'react';
import { Tabs } from './tabs.tsx';

export type EditorTab = 'edit' | 'plugins';

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
  return (
    <aside className="editor-sidebar" aria-label="Configuration du deck">
      <Tabs
        id="editor"
        label="Configuration"
        selected={selected}
        onSelect={onSelect}
        items={[
          { id: 'edit', label: 'Édition', content: children },
          { id: 'plugins', label: 'Plugins', content: plugins },
        ]}
      />
    </aside>
  );
}
