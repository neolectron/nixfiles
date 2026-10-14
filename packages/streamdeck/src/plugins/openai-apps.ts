import { Context, Effect, Layer } from 'effect';
import * as Plugin from '../plugin.ts';
import * as AppTiles from './application-tiles.ts';
import { TextSelection } from '@nixfiles/system-control/text-selection.ts';
import * as Text from './openai-text.ts';

export class OpenAIApps extends Context.Service<
  OpenAIApps,
  AppTiles.Applications & Text.SelectionActions
>()('@nixfiles/streamdeck/OpenAIApps') {
  static readonly layer = Layer.effect(
    OpenAIApps,
    Effect.gen(function* () {
      return { desktop: yield* AppTiles.desktop, selection: yield* TextSelection };
    }),
  ).pipe(Layer.provide(TextSelection.layer));
}
/** App launch is independent of the microphone/hold-to-talk plugin. */
export const plugin = Plugin.fromLayer({
  id: 'openai-apps',
  name: 'ChatGPT / Codex',
  description:
    'Applications OpenAI et transformation du texte sélectionné : traduction, correction et prompt libre.',
  controls: {},
  service: OpenAIApps,
  layer: OpenAIApps.layer,
  actions: [AppTiles.launch(AppTiles.chatgpt), AppTiles.launch(AppTiles.codex), ...Text.actions],
});
