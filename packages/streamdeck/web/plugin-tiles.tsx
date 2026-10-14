import type { Catalogue } from '../src/studio-contract.ts';
import { KeyCard } from '../src/ui/key-card.tsx';
import { DragGrip } from './drag-grip.tsx';
import { useTileDrag } from './use-tile-drag.ts';

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
}: {
  readonly action: Action;
  readonly busy: boolean;
  readonly canChoose: boolean;
  readonly onChoose: (action: Action) => void;
  readonly onDrop: (action: Action, index: number) => void;
  readonly onTarget: (index: number | null) => void;
}) {
  const { preview, handlers } = useTileDrag({
    disabled: busy,
    onDrop: (index) => onDrop(action, index),
    onTarget,
  });
  return (
    <div className={`plugin-tile${preview ? ' dragging' : ''}`}>
      <button
        className="plugin-tile-button"
        type="button"
        title={action.description}
        aria-label={action.name}
        disabled={busy || !canChoose}
        onClick={() => onChoose(action)}
      >
        <TileFace action={action} />
      </button>
      <button
        type="button"
        className="key-number key-drag-handle plugin-tile-grip"
        aria-label={`Glisser ${action.name} sur une touche`}
        title="Glisser sur une touche"
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
}: {
  readonly actions: Catalogue['pluginActions'];
  readonly busy: boolean;
  readonly canChoose?: boolean;
  readonly onChoose: (action: Action) => void;
  readonly onDrop?: (action: Action, index: number) => void;
  readonly onTarget?: (index: number | null) => void;
}) {
  const tiles = actions.filter((action) => action.tile);
  if (!tiles.length) return <p className="field-hint">Aucune tile exportée.</p>;
  return (
    <div className="plugin-tile-list">
      {tiles.map((action) => (
        <PaletteTile
          key={`${action.plugin}/${action.id}`}
          action={action}
          busy={busy}
          canChoose={canChoose}
          onChoose={onChoose}
          onDrop={onDrop}
          onTarget={onTarget}
        />
      ))}
    </div>
  );
}
