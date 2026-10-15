import { Effect } from 'effect';
import { Command, Navigation, type Controller } from '../navigation.ts';
import * as Plugin from '../plugin.ts';

const templates: Plugin.TileTemplate[] = (['keys', 'lcd', 'audio'] as const).flatMap((surface) =>
  (['next', 'previous', ...(surface === 'audio' ? [] : ['open', 'back'])] as const).map(
    (operation) => ({
      id: `${surface}-${operation}`,
      action: 'navigate',
      name: `${surface === 'keys' ? 'Touches' : surface === 'lcd' ? 'LCD' : 'Mixer'} · ${operation === 'next' ? 'Page suivante' : operation === 'previous' ? 'Page précédente' : operation === 'open' ? 'Ouvrir un dossier' : 'Retour'}`,
      label: `${surface === 'keys' ? 'Touches' : surface === 'lcd' ? 'LCD' : 'Mixer'} ${operation === 'next' ? '+' : operation === 'previous' ? '−' : operation === 'open' ? 'dossier' : 'retour'}`,
      icon: operation === 'open' || operation === 'back' ? 'folder' : 'next',
      input: { surface, zone: 'current', operation, folder: '' },
    }),
  ),
);
export const plugin = Plugin.define({
  id: 'navigation',
  name: 'Navigation',
  description: 'Dossiers et pagination des touches, du LCD ou du mixer.',
  controls: {},
  tiles: templates,
  setup: Effect.map(Navigation, (api) => ({ api })),
  actions: [
    Plugin.action({
      id: 'navigate',
      name: 'Naviguer',
      description: 'Applique une navigation à la surface et à la zone choisies.',
      input: Command,
      defaults: { surface: 'keys', zone: 'current', operation: 'next', folder: '' },
      run: (api: Controller, input, context) =>
        api.navigate(
          input,
          context.surface?.kind === (input.surface === 'keys' ? 'key' : input.surface)
            ? context.surface.zone
            : undefined,
        ),
    }),
  ],
});
