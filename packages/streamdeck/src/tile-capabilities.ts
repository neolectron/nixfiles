import type { ActionInfo } from './plugin.ts';
/** LCD hardware reports tap/hold/swipe, but cannot guarantee a hold action's release. */
export const supports = (
  action: { readonly interaction: ActionInfo['interaction']; readonly tile?: ActionInfo['tile'] },
  surface: 'key' | 'lcd',
) =>
  (!action.tile?.surfaces || action.tile.surfaces.includes(surface)) &&
  (surface !== 'lcd' || action.interaction !== 'hold');
