import { Context, Effect, Layer } from 'effect';
import * as Media from '../media.ts';
import * as Mpris from '../mpris.ts';
import * as Plugin from '../plugin.ts';
import type { KeyFeedback } from '../key-feedback.ts';

export class MediaKeys extends Context.Service<MediaKeys, Media.Controller>()('@nixfiles/streamdeck/MediaKeys') {
  static readonly layer = Layer.effect(MediaKeys, Media.make).pipe(Layer.provide(Mpris.MprisTransport.layer));
}
const action = (id: string, name: string, method: Mpris.Command, icon: KeyFeedback['icon']) => Plugin.action({
  id, name, description: 'Commande média standard du lecteur actif, sans changer le focus.', input: Plugin.NoInput, defaults: {},
  run: (api: Media.Controller) => api.command(method), unavailable: { icon, text: 'AUCUN MÉDIA', tone: 'neutral' },
  feedback: (api) => Effect.map(api.state, (state): KeyFeedback => ({
    icon: method === 'PlayPause' ? state.playback.status === 'Playing' ? 'pause' : 'play' : icon,
    text: state.name.slice(0, 40), tone: state.playback.status === 'Playing' ? 'positive' : 'neutral',
  })),
});
export const plugin = Plugin.fromLayer({ id: 'media', name: 'Touches média', description: 'Précédent, lecture/pause, suivant et arrêt du lecteur actif (MPRIS).',
  controls: {}, service: MediaKeys, layer: MediaKeys.layer, run: (api) => api.monitor, actions: [
    action('previous', 'Média précédent', 'Previous', 'previous'), action('play-pause', 'Média lecture / pause', 'PlayPause', 'play'),
    action('next', 'Média suivant', 'Next', 'next'), action('play', 'Média lire', 'Play', 'play'),
    action('pause', 'Média pause', 'Pause', 'pause'), action('stop', 'Média arrêter', 'Stop', 'stop'),
  ] });
