import { createElement as h } from 'react';
import type { Catalogue, Snapshot } from '../src/studio-contract.ts';
import * as Fields from '../src/plugin-fields.ts';

export function PluginFields({ catalogue, snapshot, values, label, busy, onChange }: {
  catalogue: Catalogue; snapshot: Snapshot; values: Record<string, string>; label: string; busy: boolean;
  onChange: (values: Record<string, string>, label: string) => void;
}) {
  const info = catalogue.pluginActions.find((action) => action.plugin === values.plugin && action.id === values.command);
  const plugins = [...new Map(catalogue.pluginActions.map((action) => [action.plugin, action.pluginName])).entries()];
  const choose = (plugin: string, command: string) => {
    const next = catalogue.pluginActions.find((action) => action.plugin === plugin && action.id === command);
    onChange({ plugin, command, ...Fields.draft(next?.schema, next?.defaults ?? {}) }, label === 'Action d’un plugin' || label === info?.name ? next?.name ?? 'Action d’un plugin' : label);
  };
  return h('div', { className: 'plugin-fields' },
    h('label', { className: 'field' }, h('span', {}, 'Plugin'), h('select', { 'aria-label': 'Plugin', required: true, value: values.plugin ?? '', disabled: busy, onChange: (event) => choose((event.currentTarget as HTMLSelectElement).value, '') },
      h('option', { value: '' }, 'Choisir un plugin'), ...plugins.map(([id, name]) => h('option', { key: id, value: id }, name)))),
    h('label', { className: 'field' }, h('span', {}, 'Action du plugin'), h('select', { 'aria-label': 'Action du plugin', required: true, value: values.command ?? '', disabled: busy || !values.plugin, onChange: (event) => choose(values.plugin!, (event.currentTarget as HTMLSelectElement).value) },
      h('option', { value: '' }, 'Choisir une action'), ...catalogue.pluginActions.filter((action) => action.plugin === values.plugin).map((action) => h('option', { key: action.id, value: action.id }, action.name)))),
    info ? h('p', { className: 'action-description' }, info.description) : null,
    ...(info ? Fields.fields(info.schema) : []).map((field) => h('label', { key: field.key, className: 'field' }, h('span', {}, field.label),
      field.kind === 'select' || field.kind === 'boolean' ? h('select', { 'aria-label': field.label, value: values[`input:${field.key}`] ?? '', required: field.required, disabled: busy, onChange: (event) => onChange({ ...values, [`input:${field.key}`]: (event.currentTarget as HTMLSelectElement).value }, label) },
        h('option', { value: '' }, field.required ? 'Choisir une valeur' : 'Valeur par défaut'), ...(field.kind === 'boolean' ? [true, false] : field.options).map((option) => h('option', { key: String(option), value: String(option) }, option === true ? 'Oui' : option === false ? 'Non' : String(option))))
      : field.kind === 'json' ? h('textarea', { 'aria-label': field.label, rows: 4, className: 'code-input', value: values[`input:${field.key}`] ?? '', disabled: busy, required: field.required, onChange: (event) => onChange({ ...values, [`input:${field.key}`]: (event.currentTarget as HTMLTextAreaElement).value }, label) })
      : h('input', { 'aria-label': field.label, type: field.kind === 'number' ? 'number' : 'text', step: 'any', min: field.min, max: field.max, minLength: field.minLength, maxLength: field.maxLength, required: field.required && (field.kind === 'number' || (field.minLength ?? 0) > 0), disabled: busy, value: values[`input:${field.key}`] ?? '', onChange: (event) => onChange({ ...values, [`input:${field.key}`]: (event.currentTarget as HTMLInputElement).value }, label) }),
      field.hint ? h('small', {}, field.hint) : null)),
    info && Fields.fields(info.schema).length === 0 ? h('p', { className: 'field-hint' }, 'Aucun paramètre.') : null,
    values.plugin && !snapshot.plugins.items.find((plugin) => plugin.id === values.plugin)?.enabled ? h('p', { className: 'field-hint' }, 'Cette affectation peut être enregistrée. Active le plugin dans Fonctionnalités pour l’utiliser.') : null,
  );
}
