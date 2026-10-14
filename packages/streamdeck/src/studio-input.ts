import { Effect } from 'effect';
import * as Gestures from './press-gestures.ts';
import type { ButtonBinding } from './studio-contract.ts';
import { StudioError } from './studio-errors.ts';
import type { StreamDeckError } from './errors.ts';

export interface Activation { readonly binding: ButtonBinding; readonly address: string; readonly revision: number }
export interface Options {
  readonly validateKey: (key: number) => Effect.Effect<void, StudioError>;
  readonly resolve: (key: number, address?: string) => Effect.Effect<Activation | undefined, StudioError>;
  readonly validate: (binding: ButtonBinding) => Effect.Effect<void, StudioError>;
  readonly press: (key: number, activation: Activation, source: string) => Effect.Effect<void, StudioError | StreamDeckError>;
  readonly release: (key: number, address?: string, revision?: number, source?: string) => Effect.Effect<void>;
}

/** Studio addresses/revisions are adapted here; all gesture semantics live in the library. */
export const make = (options: Options) => Effect.gen(function*() {
  const gestures = yield* Gestures.make<never, never>();
  const input = (key: number, phase: 'down' | 'up' | 'cancel', address?: string, source = 'physical', expectedRevision?: number) => Effect.gen(function*() {
    yield* options.validateKey(key);
    const channel = `${source}/${key}`;
    if (phase === 'down') {
      const activation = yield* options.resolve(key, address); if (!activation) return;
      if (expectedRevision !== undefined && activation.revision !== expectedRevision) return yield* Effect.fail(new StudioError({ message: 'La disposition a changé. Recharge la touche avant de tester.', status: 409 }));
      yield* options.validate(activation.binding);
      yield* gestures.down(channel, {
        identity: JSON.stringify([activation.address, activation.binding, activation.revision]),
        context: JSON.stringify([activation.address, activation.revision]),
        ...(activation.binding.trigger ? { trigger: activation.binding.trigger } : {}),
        fire: options.press(key, activation, source).pipe(Effect.catch((error) => Effect.logWarning(error.message))),
      });
    } else {
      const context = expectedRevision === undefined || address === undefined ? undefined : JSON.stringify([address, expectedRevision]);
      if (phase === 'up') yield* gestures.up(channel, context); else yield* gestures.cancel(channel, context);
      yield* options.release(key, address, expectedRevision, source);
    }
  });
  return { input, failure: gestures.failure };
});
