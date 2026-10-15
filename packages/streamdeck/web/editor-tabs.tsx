import type { ReactNode } from 'react';
import { Tabs } from './tabs.tsx';

export type EditorTab = 'edit' | 'plugins' | 'contexts' | 'diagnostics';

export function EditorTabs({
  selected,
  onSelect,
  children,
  plugins,
  diagnostics,
  contexts,
}: {
  readonly selected: EditorTab;
  readonly onSelect: (tab: EditorTab) => void;
  readonly children: ReactNode;
  readonly plugins: ReactNode;
  readonly diagnostics?: ReactNode;
  readonly contexts?: ReactNode;
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
          { id: 'contexts', label: 'Contextes', content: contexts },
          { id: 'diagnostics', label: 'Diagnostic', content: diagnostics },
        ]}
      />
    </aside>
  );
}
