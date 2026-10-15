import { invariant } from '../src/errors.ts';
import type { Catalogue, Snapshot } from '../src/studio-contract.ts';
import * as Fields from '../src/plugin-fields.ts';
import { useEffect, useId, useState } from 'react';
import { Effect, Fiber } from 'effect';
import * as Api from './api.ts';
export function PluginFields({
  catalogue,
  snapshot,
  values,
  label,
  busy,
  onChange,
  surface = 'key',
}: {
  catalogue: Catalogue;
  snapshot: Snapshot;
  values: Record<string, string>;
  label: string;
  busy: boolean;
  onChange: (values: Record<string, string>, label: string) => void;
  surface?: 'key' | 'lcd';
}) {
  const info = catalogue.pluginActions.find(
    (action) => action.plugin === values.plugin && action.id === values.command,
  );
  const listId = useId();
  const [choices, setChoices] = useState<
    Record<string, ReadonlyArray<{ value: string; label: string }>>
  >({});
  useEffect(() => {
    setChoices({});
    if (!info?.systemAction) return;
    const action = info.systemAction;
    const fiber = Effect.runFork(
      Effect.forEach(Fields.fields(info.schema), (field) =>
        Api.choices(action, field.key).pipe(
          Effect.map((items) => [field.key, items] as const),
          Effect.orElseSucceed(() => [field.key, []] as const),
        ),
      ).pipe(Effect.tap((entries) => Effect.sync(() => setChoices(Object.fromEntries(entries))))),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [info?.systemAction, info?.schema]);
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
          title={info?.description}
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
            .filter(
              (action) =>
                (!action.tile?.surfaces || action.tile.surfaces.includes(surface)) &&
                (surface !== 'lcd' || action.interaction !== 'hold'),
            )
            .map((action) => (
              <option key={action.id} value={action.id}>
                {action.name}
              </option>
            ))}
        </select>
      </label>
      {(info ? Fields.fields(info.schema) : []).map((field) => (
        <label key={field.key} className="field" title={field.hint || undefined}>
          {field.hint ? (
            <span id={`plugin-hint-${field.key}`} hidden={true}>
              {field.hint}
            </span>
          ) : null}
          <span>{field.label}</span>
          {field.kind === 'lcd-zone' || field.kind === 'lcd-folder' ? (
            <select
              aria-label={field.label}
              value={values[`input:${field.key}`] ?? ''}
              disabled={busy}
              onChange={(event) =>
                onChange({ ...values, [`input:${field.key}`]: event.currentTarget.value }, label)
              }
            >
              <option value={field.kind === 'lcd-zone' ? 'current' : ''}>
                {field.kind === 'lcd-zone'
                  ? 'Zone courante / première zone LCD'
                  : 'Choisir un dossier LCD'}
              </option>
              {(field.kind === 'lcd-zone'
                ? (snapshot.configuration.profile.lcd?.zones ?? [])
                : (snapshot.configuration.profile.lcd?.folders ?? [])
              ).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          ) : field.kind === 'select' || field.kind === 'boolean' ? (
            <select
              aria-label={field.label}
              aria-describedby={field.hint ? `plugin-hint-${field.key}` : undefined}
              title={field.hint || undefined}
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
          ) : field.kind === 'json' || field.kind === 'multiline' ? (
            <textarea
              aria-label={field.label}
              aria-describedby={field.hint ? `plugin-hint-${field.key}` : undefined}
              title={field.hint || undefined}
              rows={4}
              className={field.kind === 'json' ? 'code-input' : undefined}
              minLength={field.minLength}
              maxLength={field.maxLength}
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
            <>
              <input
                list={choices[field.key]?.length ? `${listId}-${field.key}` : undefined}
                aria-label={field.label}
                aria-describedby={field.hint ? `plugin-hint-${field.key}` : undefined}
                title={field.hint || undefined}
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
              <datalist id={`${listId}-${field.key}`}>
                {(choices[field.key] ?? []).map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </datalist>
            </>
          )}
        </label>
      ))}
      {values.plugin &&
      !snapshot.plugins.items.find((plugin) => plugin.id === values.plugin)?.enabled ? (
        <p className="field-hint" role="status">
          Plugin désactivé.
        </p>
      ) : null}
    </div>
  );
}
