import { Effect, Option, Schema } from 'effect';
import * as Counter from '@nixfiles/system-control/counters.ts';
import * as Plugin from '../plugin.ts';

/** Reference plugin: a system service, persisted instance state and no transport code. */
export const plugin = Plugin.define({
  id: 'counter',
  name: 'Compteur',
  description: 'Compteurs persistants, indépendants du matériel.',
  controls: {},
  setup: Effect.gen(function* () {
    const shared = yield* Effect.serviceOption(Counter.Counters);
    return {
      api: Option.isSome(shared)
        ? shared.value
        : yield* Counter.make('plugins/counter/state.v1.json'),
    };
  }),
  actions: [
    Plugin.action({
      id: 'increment',
      name: 'Incrémenter un compteur',
      description: 'Sauvegarde chaque incrément avant de mettre à jour la tile.',
      input: Schema.Struct({ start: Schema.Int }),
      defaults: { start: 0 },
      tile: { label: 'Compteur', icon: 'plugin' },
      run: (api: Counter.Controller, input, context) =>
        api.increment(context.instanceId ?? 'default', input.start),
      feedback: (api, input, context) =>
        Effect.succeed({
          icon: 'plugin',
          tone: 'neutral',
          text: String(api.initial(context?.instanceId ?? 'default', input.start)),
        }),
    }),
  ],
});
