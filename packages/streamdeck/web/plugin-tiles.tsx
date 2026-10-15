import type { Catalogue } from '../src/studio-contract.ts';
import { KeyCard } from '../src/ui/key-card.tsx';
import { DragGrip } from './drag-grip.tsx';
import { useTileDrag, type DropTarget } from './use-tile-drag.ts';
import { supports } from '../src/tile-capabilities.ts';

type Action = Catalogue['pluginActions'][number];
const noop = () => {};
function TileFace({ action }: { readonly action: Action }) {
  return (
    <div className="plugin-tile-face">
      <KeyCard
        width={100}
        height={100}
        label={action.tile?.label ?? action.name}
        action="plugin"
        count={0}
        status="idle"
        feedback={action.tile ? { icon: action.tile.icon, text: '', tone: 'neutral' } : null}
      />
    </div>
  );
}
function PaletteTile({
  action,
  busy,
  canChoose,
  onChoose,
  onDrop,
  onTarget,
  surface,
}: {
  readonly action: Action;
  readonly busy: boolean;
  readonly canChoose: boolean;
  readonly onChoose: (action: Action) => void;
  readonly onDrop: (action: Action, target: DropTarget) => void;
  readonly onTarget: (target: DropTarget | null) => void;
  readonly surface: 'key' | 'lcd';
}) {
  const { preview, handlers } = useTileDrag({
    disabled: busy,
    onDrop: (index) => onDrop(action, index),
    onTarget,
    key: supports(action, 'key'),
    lcd: supports(action, 'lcd'),
  });
  return (
    <div className={`plugin-tile${preview ? ' dragging' : ''}`}>
      <button
        className="plugin-tile-button"
        type="button"
        title={action.description}
        aria-label={action.name}
        disabled={busy}
        {...handlers}
        onClick={() => {
          if (canChoose && supports(action, surface)) onChoose(action);
        }}
      >
        <TileFace action={action} />
        {action.tile?.surfaces?.length === 1 && action.tile.surfaces[0] === 'lcd' ? (
          <span className="plugin-tile-surface">LCD</span>
        ) : null}
      </button>
      <button
        type="button"
        className="key-number key-drag-handle plugin-tile-grip"
        aria-label={`Glisser ${action.name} ${action.tile?.surfaces?.length === 1 && action.tile.surfaces[0] === 'lcd' ? 'sur le LCD' : 'sur une touche ou le LCD'}`}
        title="Glisser vers une surface du deck"
        disabled={busy}
        {...handlers}
      >
        <DragGrip />
      </button>
      {preview ? (
        <div
          className="plugin-tile-drag-preview"
          aria-hidden={true}
          style={{ left: preview.x - 34, top: preview.y - 34 }}
        >
          <TileFace action={action} />
        </div>
      ) : null}
    </div>
  );
}
/** Choosing or dropping a tile only prepares an editable binding; it never executes an action. */
export function PluginTiles({
  actions,
  busy,
  canChoose = true,
  onChoose,
  onDrop = noop,
  onTarget = noop,
  surface = 'key',
}: {
  readonly actions: Catalogue['pluginActions'];
  readonly busy: boolean;
  readonly canChoose?: boolean;
  readonly onChoose: (action: Action) => void;
  readonly onDrop?: (action: Action, target: DropTarget) => void;
  readonly onTarget?: (target: DropTarget | null) => void;
  readonly surface?: 'key' | 'lcd';
}) {
  const tiles = actions.filter((action) => action.tile);
  if (!tiles.length) return <p className="field-hint">Aucune tile exportée.</p>;
  return (
    <div className="plugin-tile-list">
      {tiles.map((action) => (
        <PaletteTile
          key={`${action.plugin}/${action.templateId ?? action.id}`}
          action={action}
          busy={busy}
          canChoose={canChoose}
          onChoose={onChoose}
          onDrop={onDrop}
          onTarget={onTarget}
          surface={surface}
        />
      ))}
    </div>
  );
}
