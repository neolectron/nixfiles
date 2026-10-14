import { invariant } from '../src/errors.ts';
import type { Catalogue, Snapshot } from '../src/studio-contract.ts';
import * as Fields from '../src/plugin-fields.ts';
export function PluginFields({
  catalogue,
  snapshot,
  values,
  label,
  busy,
  onChange,
}: {
  catalogue: Catalogue;
  snapshot: Snapshot;
  values: Record<string, string>;
  label: string;
  busy: boolean;
  onChange: (values: Record<string, string>, label: string) => void;
}) {
  const info = catalogue.pluginActions.find(
    (action) => action.plugin === values.plugin && action.id === values.command,
  );
  const plugins = [
    ...new Map(
      catalogue.pluginActions.map((action) => [action.plugin, action.pluginName]),
    ).entries(),
  ];
  const choose = (plugin: string, command: string) => {
    const next = catalogue.pluginActions.find(
      (action) => action.plugin === plugin && action.id === command,
    );
    onChange(
      { plugin, command, ...Fields.draft(next?.schema, next?.defaults ?? {}) },
      label === 'Action d’un plugin' || label === info?.name || label === info?.tile?.label
        ? (next?.tile?.label ?? next?.name ?? 'Action d’un plugin')
        : label,
    );
  };
  return (
    <div className="plugin-fields">
      <label className="field">
        <span>Plugin</span>
        <select
          aria-label="Plugin"
          required={true}
          value={values.plugin ?? ''}
          disabled={busy}
          onChange={(event) => choose((event.currentTarget as HTMLSelectElement).value, '')}
        >
          <option value="">Choisir un plugin</option>
          {plugins.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Action du plugin</span>
        <select
          aria-label="Action du plugin"
          required={true}
          value={values.command ?? ''}
          disabled={busy || !values.plugin}
          onChange={(event) =>
            choose(
              invariant(values.plugin, 'plugin-fields'),
              (event.currentTarget as HTMLSelectElement).value,
            )
          }
        >
          <option value="">Choisir une action</option>
          {catalogue.pluginActions
            .filter((action) => action.plugin === values.plugin)
            .map((action) => (
              <option key={action.id} value={action.id}>
                {action.name}
              </option>
            ))}
        </select>
      </label>
      {info ? <p className="action-description">{info.description}</p> : null}
      {(info ? Fields.fields(info.schema) : []).map((field) => (
        <label key={field.key} className="field">
          <span>{field.label}</span>
          {field.kind === 'select' || field.kind === 'boolean' ? (
            <select
              aria-label={field.label}
              value={values[`input:${field.key}`] ?? ''}
              required={field.required}
              disabled={busy}
              onChange={(event) =>
                onChange(
                  {
                    ...values,
                    [`input:${field.key}`]: (event.currentTarget as HTMLSelectElement).value,
                  },
                  label,
                )
              }
            >
              <option value="">
                {field.required ? 'Choisir une valeur' : 'Valeur par défaut'}
              </option>
              {(field.kind === 'boolean' ? [true, false] : field.options).map((option) => (
                <option key={String(option)} value={String(option)}>
                  {option === true ? 'Oui' : option === false ? 'Non' : String(option)}
                </option>
              ))}
            </select>
          ) : field.kind === 'json' ? (
            <textarea
              aria-label={field.label}
              rows={4}
              className="code-input"
              value={values[`input:${field.key}`] ?? ''}
              disabled={busy}
              required={field.required}
              onChange={(event) =>
                onChange(
                  {
                    ...values,
                    [`input:${field.key}`]: (event.currentTarget as HTMLTextAreaElement).value,
                  },
                  label,
                )
              }
            />
          ) : (
            <input
              aria-label={field.label}
              type={field.kind === 'number' ? 'number' : 'text'}
              step="any"
              min={field.min}
              max={field.max}
              minLength={field.minLength}
              maxLength={field.maxLength}
              required={field.required && (field.kind === 'number' || (field.minLength ?? 0) > 0)}
              disabled={busy}
              value={values[`input:${field.key}`] ?? ''}
              onChange={(event) =>
                onChange(
                  {
                    ...values,
                    [`input:${field.key}`]: (event.currentTarget as HTMLInputElement).value,
                  },
                  label,
                )
              }
            />
          )}
          {field.hint ? <small>{field.hint}</small> : null}
        </label>
      ))}
      {info && Fields.fields(info.schema).length === 0 ? (
        <p className="field-hint">Aucun paramètre.</p>
      ) : null}
      {values.plugin &&
      !snapshot.plugins.items.find((plugin) => plugin.id === values.plugin)?.enabled ? (
        <p className="field-hint">
          Cette affectation peut être enregistrée. Active le plugin dans Fonctionnalités pour
          l’utiliser.
        </p>
      ) : null}
    </div>
  );
}
