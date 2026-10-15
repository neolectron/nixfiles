import type { Catalogue, ContextRule, Snapshot } from '../src/studio-contract.ts';

/** A local presentation only: preview never sends input, persists state or changes the runtime. */
export const preview = (
  snapshot: Snapshot,
  rule: ContextRule,
  catalogue?: Catalogue,
): Snapshot => ({
  ...snapshot,
  configuration: {
    ...snapshot.configuration,
    profile: { ...snapshot.configuration.profile, ...(rule.lcd ? { lcd: rule.lcd } : {}) },
  },
  keys: snapshot.keys.map((key) => {
    if (!Object.hasOwn(rule.keys, String(key.index))) return key;
    const binding = rule.keys[String(key.index)] ?? null;
    const action =
      binding?.action === 'plugin'
        ? catalogue?.pluginActions.find(
            (info) =>
              binding.parameters.plugin === info.plugin && binding.parameters.command === info.id,
          )
        : undefined;
    return {
      ...key,
      binding,
      pressed: false,
      status: 'idle',
      detail: '',
      count: binding?.action === 'counter' ? binding.parameters.start : 0,
      feedback: action?.tile ? { icon: action.tile.icon, tone: 'neutral', text: '' } : null,
      overlay: { owner: 'context-preview', id: rule.id, name: rule.name },
    };
  }),
});
