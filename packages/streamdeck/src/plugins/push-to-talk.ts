import { Context, Effect, Layer } from 'effect';
import { IntegrationError } from '@nixfiles/system-control/errors.ts';
import * as Plugin from '../plugin.ts';
import { commandFromConfig } from './command-bridge.ts';

/** Replace this Layer with an application's native API without changing the deck binding. */
export class VoiceTarget extends Context.Service<
  VoiceTarget,
  {
    readonly ready?: Effect.Effect<void, IntegrationError>;
    readonly start: Effect.Effect<unknown, IntegrationError>;
    readonly stop: Effect.Effect<unknown, IntegrationError>;
  }
>()('@nixfiles/streamdeck/VoiceTarget') {
  static readonly commandLayer = Layer.effect(
    VoiceTarget,
    Effect.gen(function* () {
      const commands = yield* Effect.result(
        Effect.all({
          start: commandFromConfig('STREAMDECK_DOT_START'),
          stop: commandFromConfig('STREAMDECK_DOT_STOP'),
        }),
      );
      return {
        ready: Effect.asVoid(Effect.fromResult(commands)),
        start: Effect.flatMap(Effect.fromResult(commands), (value) => value.start),
        stop: Effect.flatMap(Effect.fromResult(commands), (value) => value.stop),
      };
    }),
  );
}
export const make = Effect.gen(function* () {
  const target = yield* VoiceTarget;
  const ready = target.ready ?? Effect.void;
  const hold = (context: Plugin.Invocation) =>
    Effect.scoped(
      Effect.gen(function* () {
        if (!context.released)
          return yield* Effect.fail(
            new IntegrationError({ message: 'Cette action nécessite un appui et un relâchement.' }),
          );
        yield* ready;
        // Register cleanup before starting: a partially successful start must still be stopped.
        yield* Effect.addFinalizer(() => target.stop.pipe(Effect.orDie));
        yield* target.start;
        yield* context.output('Micro actif pendant l’appui.');
        yield* context.released.pipe(Effect.timeout('2 minutes'));
        return 'Relâché.';
      }),
    );
  return { hold, ready };
});
export type Controller = Effect.Success<typeof make>;
export class PushToTalk extends Context.Service<PushToTalk, Controller>()(
  '@nixfiles/streamdeck/PushToTalk',
) {
  static readonly layer = Layer.effect(PushToTalk, make);
}
export interface VoiceActions {
  readonly voice: Controller;
}
export const action = Plugin.action({
  id: 'talk',
  name: 'Parler au dot',
  description: 'Maintenir la touche pour parler. Nécessite un VoiceTarget connecté au dot.',
  input: Plugin.NoInput,
  defaults: {},
  tile: { label: 'Parler au dot', icon: 'microphone', surfaces: ['key'] },
  interaction: 'hold',
  run: (api: VoiceActions, _input, context) => api.voice.hold(context),
  feedback: (api) =>
    api.voice.ready.pipe(
      Effect.as({ icon: 'microphone', tone: 'neutral', text: 'MAINTENIR' } as const),
    ),
  unavailable: { icon: 'microphone', tone: 'neutral', text: 'À CONNECTER' },
});
