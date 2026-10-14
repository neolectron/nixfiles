import { Schema } from 'effect';
import { ButtonBinding, type ActionId, type Catalogue } from '../src/studio-contract.ts';
import { delay, type KeyTrigger } from '../src/press-trigger.ts';
import * as Fields from '../src/plugin-fields.ts';
export type Draft = {
  action: ActionId | '';
  label: string;
  values: Record<string, string>;
  activation: KeyTrigger['type'];
  milliseconds: string;
};
export const draftOf = (binding: ButtonBinding | null, catalogue: Catalogue): Draft => {
  const activation = {
    activation: binding?.trigger?.type ?? 'press',
    milliseconds: String(binding?.trigger ? delay(binding.trigger) || 600 : 600),
  };
  if (binding?.action === 'plugin') {
    const { plugin, command, input } = binding.parameters;
    const action = catalogue.pluginActions.find(
      (currentAction) => currentAction.plugin === plugin && currentAction.id === command,
    );
    return {
      ...activation,
      action: 'plugin',
      label: binding.label,
      values: { plugin, command, ...Fields.draft(action?.schema, input) },
    };
  }
  return {
    ...activation,
    action: binding?.action ?? '',
    label: binding?.label ?? '',
    values: Object.fromEntries(
      Object.entries(
        binding?.action === 'open-folder'
          ? { ...binding.parameters, target: binding.parameters.target ?? 'current' }
          : (binding?.parameters ?? {}),
      ).map(([key, value]) => [key, Array.isArray(value) ? value.join('\n') : String(value)]),
    ),
  };
};

export const bindingOf = (draft: Draft, catalogue: Catalogue): ButtonBinding | null => {
  if (!draft.action) return null;
  const definition = catalogue.actions.find((action) => action.id === draft.action);
  if (!definition) throw new Error('Choisis une action.');
  const info = catalogue.pluginActions.find(
    (action) => action.plugin === draft.values.plugin && action.id === draft.values.command,
  );
  if (draft.action === 'plugin' && !info) throw new Error('Choisis une action du plugin.');
  if (info?.interaction === 'hold' && draft.activation === 'double-tap')
    throw new Error('Une action à maintenir n’accepte pas le double appui.');
  const parameters =
    draft.action === 'plugin'
      ? {
          plugin: draft.values.plugin ?? '',
          command: draft.values.command ?? '',
          input: Fields.input(info?.schema, draft.values),
        }
      : Object.fromEntries(
          definition.fields.map((field) => [
            field.key,
            field.kind === 'number'
              ? Number(draft.values[field.key] ?? 0)
              : field.kind === 'arguments'
                ? draft.values[field.key]
                  ? (draft.values[field.key] ?? '').split('\n')
                  : []
                : (draft.values[field.key] ?? ''),
          ]),
        );
  const candidate = {
    action: draft.action,
    label: draft.label || definition.name,
    parameters,
    ...(draft.activation !== 'press'
      ? { trigger: { type: draft.activation, milliseconds: Number(draft.milliseconds) } }
      : {}),
  };
  return Schema.decodeUnknownSync(ButtonBinding)(candidate);
};
