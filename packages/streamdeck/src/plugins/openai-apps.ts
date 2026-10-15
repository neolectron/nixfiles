import { Context, Effect, Layer } from 'effect';
import * as Plugin from '../plugin.ts';
import * as AppTiles from './application-tiles.ts';
import { TextSelection } from '@nixfiles/system-control/text-selection.ts';
import * as Text from './openai-text.ts';
import { CodexPrompt } from '@nixfiles/system-control/codex-prompt.ts';
import * as Prompt from './openai-prompt.ts';
import * as Dot from '@nixfiles/system-control/dot-call.ts';
import * as Call from './openai-call.ts';
import * as Talk from './push-to-talk.ts';

export class OpenAIApps extends Context.Service<
  OpenAIApps,
  AppTiles.Applications &
    Text.SelectionActions &
    Prompt.PromptActions &
    Call.CallActions &
    Talk.VoiceActions
>()('@nixfiles/streamdeck/OpenAIApps') {
  static readonly layer = Layer.effect(
    OpenAIApps,
    Effect.gen(function* () {
      const provided = yield* Effect.serviceOption(Talk.VoiceTarget);
      const target =
        provided._tag === 'Some'
          ? provided.value
          : Context.get(yield* Layer.build(Talk.VoiceTarget.commandLayer), Talk.VoiceTarget);
      const sharedPrompt = yield* Effect.serviceOption(CodexPrompt);
      return {
        desktop: yield* AppTiles.desktop,
        selection: yield* TextSelection,
        prompts:
          sharedPrompt._tag === 'Some'
            ? sharedPrompt.value
            : Context.get(yield* Layer.build(CodexPrompt.layer), CodexPrompt),
        dot: yield* Dot.shared,
        voice: yield* Talk.make.pipe(Effect.provideService(Talk.VoiceTarget, target)),
      };
    }),
  ).pipe(Layer.provide(TextSelection.layer));
}
/** Optional voice bridges never prevent launch, prompt or selection actions from activating. */
export const plugin = Plugin.fromLayer({
  id: 'openai-apps',
  name: 'ChatGPT / Codex',
  description:
    'Applications OpenAI, appels et push-to-talk du dot, prompts Codex et transformation du texte sélectionné.',
  controls: {},
  service: OpenAIApps,
  layer: OpenAIApps.layer,
  actions: [
    AppTiles.launch(AppTiles.chatgpt),
    AppTiles.launch(AppTiles.codex),
    Prompt.action,
    Talk.action,
    ...Call.actions,
    ...Text.actions,
  ],
});
