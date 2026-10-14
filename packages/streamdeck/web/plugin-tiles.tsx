import type { Catalogue } from '../src/studio-contract.ts';
import { FeedbackIcon } from '../src/ui/feedback-icon.tsx';

/** Choosing a tile only prepares an editable binding; it never executes an action. */
export function PluginTiles({
  catalogue,
  busy,
  onChoose,
}: {
  readonly catalogue: Catalogue;
  readonly busy: boolean;
  readonly onChoose: (action: Catalogue['pluginActions'][number]) => void;
}) {
  const tiles = catalogue.pluginActions.flatMap((action) =>
    action.tile ? [{ action, tile: action.tile }] : [],
  );
  if (!tiles.length) return null;
  return (
    <details className="plugin-tiles">
      <summary>Tiles des plugins</summary>
      <p className="field-hint">
        Icône et état en direct inclus. Choisis une tile, puis enregistre la touche.
      </p>
      <div className="plugin-tile-list">
        {tiles.map(({ action, tile }) => (
          <button
            key={`${action.plugin}/${action.id}`}
            type="button"
            className="plugin-tile"
            disabled={busy}
            onClick={() => onChoose(action)}
          >
            <FeedbackIcon feedback={{ icon: tile.icon, text: '', tone: 'neutral' }} size={24} />
            <span>
              <strong>{action.name}</strong>
              <small>{action.pluginName}</small>
            </span>
          </button>
        ))}
      </div>
    </details>
  );
}
