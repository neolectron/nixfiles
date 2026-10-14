import { Context, Effect, Layer } from 'effect';
import { IntegrationError } from '@nixfiles/system-control/errors.ts';
import * as Plugin from '../plugin.ts';
import { commandFromConfig } from './command-bridge.ts';

/** Replace this Layer with an application's native API without changing the deck binding. */
export class VoiceTarget extends Context.Service<
  VoiceTarget,
  {
    readonly start: Effect.Effect<unknown, IntegrationError>;
    readonly stop: Effect.Effect<unknown, IntegrationError>;
  }
>()('@nixfiles/streamdeck/VoiceTarget') {
  static readonly commandLayer = Layer.effect(
    VoiceTarget,
    Effect.gen(function* () {
      const start = yield* commandFromConfig('STREAMDECK_DOT_START');
      const stop = yield* commandFromConfig('STREAMDECK_DOT_STOP');
      return { start, stop };
    }),
  );
}
export const make = Effect.gen(function* () {
  const target = yield* VoiceTarget;
  const hold = (context: Plugin.Invocation) =>
    Effect.scoped(
      Effect.gen(function* () {
        if (!context.released)
          return yield* Effect.fail(
            new IntegrationError({ message: 'Cette action nécessite un appui et un relâchement.' }),
          );
        // Register cleanup before starting: a partially successful start must still be stopped.
        yield* Effect.addFinalizer(() => target.stop.pipe(Effect.orDie));
        yield* target.start;
        yield* context.output('Micro actif pendant l’appui.');
        yield* context.released.pipe(Effect.timeout('2 minutes'));
        return 'Relâché.';
      }),
    );
  return { hold };
});
export type Controller = Effect.Success<typeof make>;
export class PushToTalk extends Context.Service<PushToTalk, Controller>()(
  '@nixfiles/streamdeck/PushToTalk',
) {
  static readonly layer = Layer.effect(PushToTalk, make);
}
export const plugin = <E, R>(target: Layer.Layer<VoiceTarget, E, R>) =>
  Plugin.fromLayer({
    id: 'dot-voice',
    name: 'Dot · push-to-talk',
    description: 'Parler pendant l’appui ; relâchement et désactivation arrêtent la capture.',
    controls: {},
    service: PushToTalk,
    layer: PushToTalk.layer.pipe(Layer.provide(target)),
    actions: [
      Plugin.action({
        id: 'talk',
        name: 'Parler au dot',
        description: 'Maintenir la touche pour parler. Nécessite un VoiceTarget connecté au dot.',
        input: Plugin.NoInput,
        defaults: {},
        interaction: 'hold',
        run: (api: Controller, _input, context) => api.hold(context),
        feedback: () => Effect.succeed({ icon: 'microphone', tone: 'neutral', text: 'MAINTENIR' }),
        unavailable: { icon: 'microphone', tone: 'neutral', text: 'À CONNECTER' },
      }),
    ],
  });
