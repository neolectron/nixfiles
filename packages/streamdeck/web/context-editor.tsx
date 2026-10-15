import { useState } from 'react';
import type { ContextRule, Snapshot } from '../src/studio-contract.ts';
import { select } from '../src/context-rules.ts';
import * as Layout from '../src/studio-layout.ts';

export function ContextEditor({
  snapshot,
  onChange,
  disabled,
  previewId,
  onPreview,
}: {
  snapshot: Snapshot;
  onChange: (rules: ReadonlyArray<ContextRule>) => void;
  disabled: boolean;
  previewId: string | null;
  onPreview: (id: string | null) => void;
}) {
  const rules = snapshot.configuration.profile.contexts ?? [];
  const [application, setApplication] = useState('');
  const [zoneId, setZoneId] = useState('deck');
  const current = snapshot.lcdLayout?.focus ?? null;
  const match = select(rules, application || current);
  const patch = (rule: ContextRule) =>
    onChange(rules.map((entry) => (entry.id === rule.id ? rule : entry)));
  const capture = (zone: string) => {
    const projection = Layout.project(
      snapshot.configuration.profile,
      snapshot.configuration.navigation,
      snapshot.layout.revision,
    );
    return Object.fromEntries(
      [...projection.keys]
        .filter(([, slot]) => slot.zone === zone)
        .map(([key, slot]) => [String(key), slot.entry?.binding ?? null]),
    );
  };
  return (
    <section className="inspector" aria-label="Layouts contextuels">
      <h2>Contextes</h2>
      {!snapshot.plugins.items.find((plugin) => plugin.id === 'context-layout')?.enabled ? (
        <p className="field-hint">
          Active « Layouts contextuels » dans Plugins pour appliquer ces règles.
        </p>
      ) : null}
      <label className="field">
        <span>Application à prévisualiser</span>
        <input
          value={application}
          placeholder={current ?? 'app_id'}
          onChange={(event) => setApplication(event.currentTarget.value)}
        />
      </label>
      <p className="muted">{match ? `Layout actif : ${match.name}` : 'Layout principal'}</p>
      <label className="field">
        <span>Zone à capturer</span>
        <select
          value={zoneId}
          onChange={(event) => setZoneId(event.currentTarget.value)}
          disabled={disabled}
        >
          {snapshot.configuration.profile.zones.map((zone) => (
            <option key={zone.id} value={zone.id}>
              {zone.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          onChange([
            ...rules,
            {
              id: crypto.randomUUID(),
              name: 'Nouveau contexte',
              applications: application || current ? [application || current || ''] : [],
              priority: 0,
              keys: capture(zoneId),
            },
          ])
        }
      >
        Ajouter un contexte
      </button>
      {rules.map((rule) => (
        <details key={rule.id} className="context-rule">
          <summary>{rule.name}</summary>
          <button
            type="button"
            aria-pressed={previewId === rule.id}
            onClick={() => onPreview(previewId === rule.id ? null : rule.id)}
          >
            {previewId === rule.id ? 'Fermer l’aperçu' : 'Prévisualiser sur le deck'}
          </button>
          <label className="field">
            <span>Nom du contexte</span>
            <input
              value={rule.name}
              disabled={disabled}
              onChange={(event) => {
                if (event.currentTarget.value.trim())
                  patch({ ...rule, name: event.currentTarget.value });
              }}
            />
          </label>
          <label className="field">
            <span>Application (app_id)</span>
            <input
              value={rule.applications.join(', ')}
              disabled={disabled}
              onChange={(event) =>
                patch({
                  ...rule,
                  applications: event.currentTarget.value
                    .split(',')
                    .map((id) => id.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <label className="field">
            <span>Priorité</span>
            <input
              type="number"
              value={rule.priority}
              disabled={disabled}
              onChange={(event) => {
                const priority = Number(event.currentTarget.value);
                if (Number.isInteger(priority)) patch({ ...rule, priority });
              }}
            />
          </label>
          <ul className="context-keys">
            {Object.entries(rule.keys).map(([key, binding]) => (
              <li key={key}>
                {Number(key) + 1} · {binding?.label ?? 'Vide'}
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={disabled}
            onClick={() => patch({ ...rule, keys: capture(zoneId) })}
          >
            Capturer la zone
          </button>
          <label className="integration-toggle">
            <span>Inclure le layout LCD</span>
            <input
              type="checkbox"
              disabled={disabled}
              checked={!!rule.lcd}
              onChange={(event) => {
                const { lcd: _lcd, ...rest } = rule;
                patch(
                  event.currentTarget.checked
                    ? {
                        ...rest,
                        lcd: snapshot.configuration.profile.lcd ?? { zones: [], folders: [] },
                      }
                    : rest,
                );
              }}
            />
          </label>
          <button
            type="button"
            className="danger"
            disabled={disabled}
            onClick={() => onChange(rules.filter((entry) => entry.id !== rule.id))}
          >
            Supprimer le contexte
          </button>
        </details>
      ))}
    </section>
  );
}
