import { Context, Effect, Layer } from 'effect';
import * as Plugin from '../plugin.ts';
import * as AppTiles from './application-tiles.ts';
import { TextSelection } from '@nixfiles/system-control/text-selection.ts';
import * as Text from './openai-text.ts';
import { CodexPrompt } from '@nixfiles/system-control/codex-prompt.ts';
import * as Prompt from './openai-prompt.ts';
import * as Dot from '@nixfiles/system-control/dot-call.ts';
import * as Call from './openai-call.ts';

export class OpenAIApps extends Context.Service<
  OpenAIApps,
  AppTiles.Applications & Text.SelectionActions & Prompt.PromptActions & Call.CallActions
>()('@nixfiles/streamdeck/OpenAIApps') {
  static readonly layer = Layer.effect(
    OpenAIApps,
    Effect.gen(function* () {
      return {
        desktop: yield* AppTiles.desktop,
        selection: yield* TextSelection,
        prompts: yield* CodexPrompt,
        dot: yield* Dot.shared,
      };
    }),
  ).pipe(Layer.provide(Layer.merge(TextSelection.layer, CodexPrompt.layer)));
}
/** App launch is independent of the microphone/hold-to-talk plugin. */
export const plugin = Plugin.fromLayer({
  id: 'openai-apps',
  name: 'ChatGPT / Codex',
  description:
    'Applications OpenAI, appels du dot, prompts Codex et transformation du texte sélectionné.',
  controls: {},
  service: OpenAIApps,
  layer: OpenAIApps.layer,
  actions: [
    AppTiles.launch(AppTiles.chatgpt),
    AppTiles.launch(AppTiles.codex),
    Prompt.action,
    ...Call.actions,
    ...Text.actions,
  ],
});
