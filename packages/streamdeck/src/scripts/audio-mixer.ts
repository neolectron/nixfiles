import { Effect } from 'effect';
import { PluginHost } from '../plugin-host.ts';
import * as AudioMixer from '../plugins/audio-mixer.ts';
import { StreamDeck } from '../stream-deck.ts';

/** CLI and studio use exactly the same scoped plugin implementation. */
export const mixer = (options: AudioMixer.MixerOptions = {}) => Effect.scoped(Effect.gen(function*() {
  const host = yield* PluginHost;
  yield* host.install(AudioMixer.plugin(options));
  yield* host.setEnabled('audio-mixer', true);
  yield* (yield* StreamDeck).awaitFailure;
})).pipe(Effect.provide(PluginHost.layer));
