import { Context, Effect, Layer } from 'effect';
import { StudioError } from '../studio-errors.ts';
import * as Actions from '../studio-actions.ts';
import * as Bindings from '../bindings.ts';
import * as Plugin from '../plugin.ts';
import { StreamDeck, type Device } from '../stream-deck.ts';
import type { ApplicationEntry } from '../studio-contract.ts';

export interface Options {
  readonly profile: string;
  readonly applications: ReadonlyArray<ApplicationEntry>;
  readonly pluginActions?: Parameters<typeof Actions.make>[4];
  readonly audioPage: (direction: number) => Effect.Effect<void, StudioError>;
}
export const make = (options: Options) => Effect.gen(function*() {
  const deck = yield* StreamDeck;
  const actions = yield* Actions.make(deck, options.profile, options.applications, options.audioPage, options.pluginActions);
  const binding = yield* Bindings.start({ buttons: Object.fromEntries(deck.buttons.map((key) => [key.index, {
    onPress: actions.press(key.index).pipe(Effect.catch((error) => Effect.logWarning(error.message))),
    onRelease: actions.release(key.index),
  }])) });
  return { ...actions, run: Effect.all([binding.run, Effect.forever(actions.refreshFeedback.pipe(Effect.andThen(Effect.sleep(250))))], { concurrency: 'unbounded' }) };
});
export type Controller = Effect.Success<ReturnType<typeof make>>;
export class Shortcuts extends Context.Service<Shortcuts, Effect.Success<ReturnType<typeof make>>>()('@nixfiles/streamdeck/Shortcuts') {
  static readonly layer = (options: Options) => Layer.effect(Shortcuts, make(options));
}
export const plugin = (options: Options) => Plugin.fromLayer({
  id: 'shortcuts', name: 'Raccourcis', description: 'Applications, commandes, dossiers et zones de touches paginées.',
  controls: (deck: Device) => ({ keys: deck.buttons.map((key) => key.index) }),
  service: Shortcuts, layer: Shortcuts.layer(options), run: (api) => api.run,
});
