import type { Catalogue, GestureBindings } from '../src/studio-contract.ts';

/** Additional gestures use ready-to-assign actions; arbitration remains in the input library. */
export function GestureBindingsEditor({
  value,
  catalogue,
  disabled,
  onChange,
}: {
  value: GestureBindings;
  catalogue: Catalogue;
  disabled: boolean;
  onChange: (value: GestureBindings) => void;
}) {
  return (
    <details className="gesture-bindings">
      <summary>Gestes supplémentaires</summary>
      {(
        [
          ['longPress', 'Appui long'],
          ['doubleTap', 'Double appui'],
        ] as const
      ).map(([kind, label]) => {
        const binding = value[kind];
        const selected =
          binding?.action === 'plugin'
            ? `${binding.parameters.plugin}/${binding.parameters.command}`
            : '';
        return (
          <label className="field" key={kind}>
            <span>{label}</span>
            <select
              aria-label={`Action · ${label}`}
              disabled={disabled}
              value={selected}
              onChange={(event) => {
                const action = catalogue.pluginActions.find(
                  (entry) => `${entry.plugin}/${entry.id}` === event.currentTarget.value,
                );
                const next = { ...value };
                if (!action) delete next[kind];
                else
                  next[kind] = {
                    label: action.tile?.label ?? action.name,
                    action: 'plugin',
                    parameters: {
                      plugin: action.plugin,
                      command: action.id,
                      input: action.defaults,
                    },
                    trigger: { type: kind === 'longPress' ? 'long-press' : 'double-tap' },
                  };
                onChange(next);
              }}
            >
              <option value="">Aucune action supplémentaire</option>
              {catalogue.pluginActions
                .filter((entry) => entry.interaction !== 'hold' || kind === 'longPress')
                .map((entry) => (
                  <option key={`${entry.plugin}/${entry.id}`} value={`${entry.plugin}/${entry.id}`}>
                    {entry.pluginName} · {entry.name}
                  </option>
                ))}
            </select>
          </label>
        );
      })}
    </details>
  );
}
