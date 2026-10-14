import { Spotify } from '@nixfiles/system-control/spotify.ts';
import { Context, Effect, Layer, Option, Schema } from 'effect';
import * as Mpris from '@nixfiles/system-control/mpris.ts';
import * as Plugin from '../plugin.ts';
import type { KeyFeedback } from '../key-feedback.ts';
import * as Player from '@nixfiles/system-control/spotify.ts';
import * as Lcd from './spotify-lcd.tsx';
import { MixerCards } from '../mixer-cards.ts';

type Icon = KeyFeedback['icon'];
const unavailable = (icon: Icon): KeyFeedback => ({ icon, text: 'HORS LIGNE', tone: 'neutral' });
const playback = (state: Mpris.State): KeyFeedback => ({
  icon: state.status === 'Playing' ? 'pause' : 'play',
  text: state.status === 'Playing' ? 'LECTURE' : state.status === 'Paused' ? 'PAUSE' : 'ARRÊT',
  tone: state.status === 'Playing' ? 'positive' : 'neutral',
});
const transport = (
  id: string,
  name: string,
  description: string,
  method: Mpris.Command,
  icon: Icon,
) =>
  Plugin.action({
    id,
    name,
    description,
    input: Plugin.NoInput,
    defaults: {},
    run: (api: Mpris.Controller) => api.command(method),
    unavailable: unavailable(icon),
    feedback: (api) =>
      Effect.map(api.state, (state) =>
        method === 'PlayPause'
          ? playback(state)
          : {
              icon,
              text:
                method === 'Next' || method === 'Previous'
                  ? state.title.slice(0, 40) || playback(state).text
                  : playback(state).text,
              tone: playback(state).tone,
            },
      ),
  });
export const run = (api: Player.Controller) =>
  Effect.gen(function* () {
    const cards = yield* Effect.serviceOption(MixerCards);
    if (Option.isSome(cards))
      yield* Lcd.register(api).pipe(Effect.provideService(MixerCards, cards.value));
    yield* Effect.never;
  });
export const plugin = Plugin.fromLayer({
  id: 'spotify',
  name: 'Spotify / Spotifast',
  description: 'Lecture, pistes et vue tactile du titre, artiste et progression via MPRIS local.',
  controls: {},
  service: Spotify,
  layer: Layer.effect(
    Spotify,
    Effect.gen(function* () {
      const shared = yield* Effect.serviceOption(Spotify);
      if (Option.isSome(shared)) return shared.value;
      return Context.get(yield* Layer.build(Spotify.layer), Spotify);
    }),
  ),
  run,
  actions: [
    transport(
      'play-pause',
      'Lecture / pause',
      'Bascule la lecture ; la touche suit l’état réel de Spotify.',
      'PlayPause',
      'play',
    ),
    transport('next', 'Piste suivante', 'Passe à la piste suivante.', 'Next', 'next'),
    transport(
      'previous',
      'Piste précédente',
      'Passe à la piste précédente.',
      'Previous',
      'previous',
    ),
    transport('play', 'Lire', 'Démarre ou reprend la lecture.', 'Play', 'play'),
    transport('pause', 'Pause', 'Met la lecture en pause.', 'Pause', 'pause'),
    transport('stop', 'Arrêter', 'Arrête la lecture si Spotify le permet.', 'Stop', 'stop'),
    Plugin.action({
      id: 'shuffle',
      name: 'Aléatoire',
      description: 'Bascule la lecture aléatoire.',
      input: Plugin.NoInput,
      defaults: {},
      run: (api: Mpris.Controller) => api.toggleShuffle,
      unavailable: unavailable('shuffle'),
      feedback: (api) =>
        Effect.map(api.state, (state) => ({
          icon: 'shuffle',
          text: state.shuffle === null ? 'INDISPONIBLE' : state.shuffle ? 'ACTIF' : 'INACTIF',
          tone: state.shuffle ? 'positive' : 'neutral',
        })),
    }),
    Plugin.action({
      id: 'repeat',
      name: 'Répétition',
      description: 'Parcourt : aucune, playlist, piste.',
      input: Plugin.NoInput,
      defaults: {},
      run: (api: Mpris.Controller) => api.cycleLoop,
      unavailable: unavailable('repeat'),
      feedback: (api) =>
        Effect.map(api.state, (state) => ({
          icon: 'repeat',
          text:
            state.loop === null
              ? 'INDISPONIBLE'
              : state.loop === 'None'
                ? 'INACTIVE'
                : state.loop === 'Playlist'
                  ? 'PLAYLIST'
                  : 'PISTE',
          tone: state.loop && state.loop !== 'None' ? 'positive' : 'neutral',
        })),
    }),
    Plugin.action({
      id: 'seek',
      name: 'Avancer / reculer',
      description: 'Se déplace dans la piste, en secondes (négatif pour reculer).',
      input: Schema.Struct({
        seconds: Schema.Number.check(Schema.isBetween({ minimum: -300, maximum: 300 })).annotate({
          title: 'Secondes',
        }),
      }),
      defaults: { seconds: 10 },
      run: (api: Mpris.Controller, { seconds }) => api.seek(seconds),
      unavailable: unavailable('music'),
      feedback: (api) =>
        Effect.map(api.state, (state) => ({
          icon: 'music',
          text: state.title.slice(0, 40) || playback(state).text,
          tone: playback(state).tone,
        })),
    }),
    Plugin.action({
      id: 'status',
      name: 'Piste en cours',
      description: 'Affiche le titre sur la touche et lit les métadonnées dans l’inspecteur.',
      input: Plugin.NoInput,
      defaults: {},
      run: (api: Mpris.Controller) => api.current,
      unavailable: unavailable('music'),
      feedback: (api) =>
        Effect.map(api.state, (state) => ({
          icon: 'music',
          text: state.title.slice(0, 40) || playback(state).text,
          tone: playback(state).tone,
        })),
    }),
  ],
});
