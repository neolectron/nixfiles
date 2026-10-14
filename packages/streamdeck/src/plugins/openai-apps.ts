import { Context, Effect, Layer } from 'effect';
import * as Plugin from '../plugin.ts';
import * as AppTiles from './application-tiles.ts';

export class OpenAIApps extends Context.Service<OpenAIApps, AppTiles.Applications>()(
  '@nixfiles/streamdeck/OpenAIApps',
) {
  static readonly layer = Layer.effect(
    OpenAIApps,
    Effect.map(AppTiles.desktop, (desktop) => ({ desktop })),
  );
}
/** App launch is independent of the microphone/hold-to-talk plugin. */
export const plugin = Plugin.fromLayer({
  id: 'openai-apps',
  name: 'ChatGPT / Codex',
  description: 'Applications OpenAI : ouverture et état des fenêtres, sans activer le micro.',
  controls: {},
  service: OpenAIApps,
  layer: OpenAIApps.layer,
  actions: [AppTiles.launch(AppTiles.chatgpt), AppTiles.launch(AppTiles.codex)],
});
