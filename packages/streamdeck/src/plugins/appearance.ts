import { Context, Effect, Layer, Option } from 'effect';
import { SystemAppearance, type Controller } from '@nixfiles/system-control/appearance.ts';
import * as Plugin from '../plugin.ts';
import type { KeyFeedback } from '../key-feedback.ts';

const action = (
  id: 'toggle' | 'dark' | 'light',
  name: string,
  label: string,
  icon: KeyFeedback['icon'],
) =>
  Plugin.action({
    id,
    name,
    description: 'Change le thème Noctalia et la préférence système suivie par les applications.',
    input: Plugin.NoInput,
    defaults: {},
    tile: { label, icon },
    run: (api: Controller) =>
      (id === 'toggle' ? api.toggle : api.set(id)).pipe(
        Effect.map((state) => (state.mode === 'dark' ? 'Thème sombre.' : 'Thème clair.')),
      ),
    feedback: (api: Controller) =>
      Effect.map(
        api.state,
        (state): KeyFeedback => ({
          icon: state.mode === 'dark' ? 'moon' : 'sun',
          text: state.mode === 'dark' ? 'SOMBRE' : 'CLAIR',
          tone: id !== 'toggle' && id === state.mode ? 'positive' : 'neutral',
        }),
      ),
    unavailable: { icon, text: 'INDISPONIBLE', tone: 'neutral' },
  });
export const plugin = Plugin.fromLayer({
  id: 'appearance',
  name: 'Thème système',
  description: 'Bascule sombre/clair et synchronise les applications qui suivent le thème système.',
  controls: {},
  service: SystemAppearance,
  layer: Layer.effect(
    SystemAppearance,
    Effect.gen(function* () {
      const shared = yield* Effect.serviceOption(SystemAppearance);
      return Option.isSome(shared)
        ? shared.value
        : Context.get(yield* Layer.build(SystemAppearance.layer), SystemAppearance);
    }),
  ),
  actions: [
    action('toggle', 'Basculer le thème système', 'Sombre / clair', 'theme'),
    action('dark', 'Activer le thème sombre', 'Mode sombre', 'moon'),
    action('light', 'Activer le thème clair', 'Mode clair', 'sun'),
  ],
});
