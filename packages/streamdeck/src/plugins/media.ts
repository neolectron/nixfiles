import { MediaPlayers } from '@nixfiles/system-control/media.ts';
import { Context, Effect, Layer } from 'effect';
import * as Media from '@nixfiles/system-control/media.ts';
import * as Mpris from '@nixfiles/system-control/mpris.ts';
import * as Plugin from '../plugin.ts';
import * as SystemAction from '../system-action.ts';
import type { KeyFeedback } from '../key-feedback.ts';

const action = (id: string, name: string, method: Mpris.Command, icon: KeyFeedback['icon']) =>
  Plugin.action({
    id,
    systemAction: `media.${id}`,
    name,
    description: 'Commande média standard du lecteur actif, sans changer le focus.',
    input: Plugin.NoInput,
    defaults: {},
    tile: { label: name, icon },
    run: (api: Media.Controller) => SystemAction.invoke(`media.${id}`, {}, api.command(method)),
    unavailable: { icon, text: 'AUCUN MÉDIA', tone: 'neutral' },
    feedback: (api) =>
      Effect.map(
        api.state,
        (state): KeyFeedback => ({
          icon:
            method === 'PlayPause'
              ? state.playback.status === 'Playing'
                ? 'pause'
                : 'play'
              : icon,
          text: state.name.slice(0, 40),
          tone: state.playback.status === 'Playing' ? 'positive' : 'neutral',
        }),
      ),
  });
export const plugin = Plugin.fromLayer({
  id: 'media',
  name: 'Touches média',
  description: 'Précédent, lecture/pause, suivant et arrêt du lecteur actif (MPRIS).',
  controls: {},
  service: MediaPlayers,
  layer: Layer.effect(
    MediaPlayers,
    Effect.gen(function* () {
      const shared = yield* Effect.serviceOption(MediaPlayers);
      if (shared._tag === 'Some') return shared.value;
      return Context.get(yield* Layer.build(MediaPlayers.layer), MediaPlayers);
    }),
  ),

  actions: [
    action('previous', 'Média précédent', 'Previous', 'previous'),
    action('play-pause', 'Média lecture / pause', 'PlayPause', 'play'),
    action('next', 'Média suivant', 'Next', 'next'),
    action('play', 'Média lire', 'Play', 'play'),
    action('pause', 'Média pause', 'Pause', 'pause'),
    action('stop', 'Média arrêter', 'Stop', 'stop'),
  ],
});
