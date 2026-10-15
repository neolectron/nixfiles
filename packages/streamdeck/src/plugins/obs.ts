import * as Rpc from '@nixfiles/system-control/obs-rpc.ts';
import {
  Obs as SystemObs,
  type Controller as SystemController,
} from '@nixfiles/system-control/obs.ts';
import { Context, Effect, Layer, Option, Schema } from 'effect';
import * as Plugin from '../plugin.ts';
import * as AppTiles from './application-tiles.ts';
import type { KeyFeedback } from '../key-feedback.ts';
export const authentication = Rpc.authentication;
export const make = Rpc.make;
export type Controller = SystemController & AppTiles.Applications;
export class Obs extends Context.Service<Obs, Controller>()('@nixfiles/streamdeck/Obs') {
  static readonly layer = Layer.effect(
    Obs,
    Effect.gen(function* () {
      const shared = yield* Effect.serviceOption(SystemObs);
      const api = Option.isSome(shared)
        ? shared.value
        : Context.get(yield* Layer.build(SystemObs.layer), SystemObs);
      return { ...api, desktop: yield* AppTiles.desktop };
    }),
  );
}
const empty = Plugin.NoInput;
const simple = (
  id: string,
  name: string,
  description: string,
  request: string,
  { icon = 'obs', label = name }: { icon?: KeyFeedback['icon']; label?: string } = {},
) =>
  Plugin.action({
    id,
    name,
    description,
    input: empty,
    defaults: {},
    tile: { label, icon },
    run: (api: Controller) => api.request(request),
    feedback: (api) => api.state.pipe(Effect.as({ icon, text: 'PRÊT', tone: 'neutral' } as const)),
    unavailable: { icon, text: 'HORS LIGNE', tone: 'neutral' },
  });
export const plugin = Plugin.fromLayer({
  id: 'obs',
  name: 'OBS Studio',
  description: 'Scènes, sources, enregistrement et diffusion via obs-websocket 5.',
  controls: {},
  service: Obs,
  layer: Obs.layer,
  run: () => Effect.never,
  actions: [
    AppTiles.launch<Controller>(AppTiles.obs),
    simple(
      'status',
      'État OBS',
      'Lit l’état de l’enregistrement, sans le démarrer.',
      'GetRecordStatus',
    ),
    simple(
      'record',
      'Enregistrement',
      'Démarre ou arrête l’enregistrement lors de l’appui.',
      'ToggleRecord',
      { icon: 'obs', label: 'REC on / off' },
    ),
    simple(
      'start-record',
      'Démarrer l’enregistrement',
      'Démarre un enregistrement OBS.',
      'StartRecord',
      { icon: 'obs', label: 'Enregistrer' },
    ),
    simple(
      'stop-record',
      'Arrêter l’enregistrement',
      'Arrête l’enregistrement OBS.',
      'StopRecord',
      { icon: 'stop', label: 'Arrêter REC' },
    ),
    simple(
      'pause-record',
      'Pause enregistrement',
      'Met en pause un enregistrement en cours.',
      'PauseRecord',
      { icon: 'pause', label: 'Pause REC' },
    ),
    simple(
      'resume-record',
      'Reprendre l’enregistrement',
      'Reprend un enregistrement en pause.',
      'ResumeRecord',
      { icon: 'play', label: 'Reprendre REC' },
    ),
    simple(
      'toggle-record-pause',
      'Pause / reprise enregistrement',
      'Bascule la pause de l’enregistrement en cours.',
      'ToggleRecordPause',
      { icon: 'pause', label: 'Pause / reprise' },
    ),
    simple(
      'stream',
      'Diffusion',
      'Démarre ou arrête la diffusion lors de l’appui.',
      'ToggleStream',
      { icon: 'obs', label: 'Stream on / off' },
    ),
    simple('start-stream', 'Démarrer le stream', 'Démarre la diffusion OBS.', 'StartStream', {
      icon: 'obs',
      label: 'Lancer stream',
    }),
    simple('stop-stream', 'Arrêter le stream', 'Arrête la diffusion OBS.', 'StopStream', {
      icon: 'stop',
      label: 'Arrêter stream',
    }),
    simple(
      'virtual-camera',
      'Caméra virtuelle',
      'Démarre ou arrête la caméra virtuelle.',
      'ToggleVirtualCam',
      { icon: 'obs', label: 'Caméra on / off' },
    ),
    simple(
      'start-virtual-camera',
      'Démarrer la caméra virtuelle',
      'Démarre la caméra virtuelle OBS.',
      'StartVirtualCam',
      { icon: 'obs', label: 'Caméra on' },
    ),
    simple(
      'stop-virtual-camera',
      'Arrêter la caméra virtuelle',
      'Arrête la caméra virtuelle OBS.',
      'StopVirtualCam',
      { icon: 'stop', label: 'Caméra off' },
    ),
    simple(
      'start-replay',
      'Démarrer le buffer replay',
      'Démarre le tampon de replay OBS.',
      'StartReplayBuffer',
      { icon: 'repeat', label: 'Replay on' },
    ),
    simple(
      'stop-replay',
      'Arrêter le buffer replay',
      'Arrête le tampon de replay OBS.',
      'StopReplayBuffer',
      { icon: 'stop', label: 'Replay off' },
    ),
    simple(
      'toggle-replay',
      'Buffer replay on / off',
      'Bascule le tampon de replay OBS.',
      'ToggleReplayBuffer',
      { icon: 'repeat', label: 'Replay on / off' },
    ),
    simple(
      'save-replay',
      'Sauver le replay',
      'Sauve le replay si le buffer est déjà actif.',
      'SaveReplayBuffer',
      { icon: 'repeat', label: 'Sauver replay' },
    ),
    Plugin.action({
      id: 'scene',
      name: 'Changer de scène',
      description: 'Sélectionne la scène du programme.',
      input: Schema.Struct({ sceneName: Schema.NonEmptyString.annotate({ title: 'Scène' }) }),
      defaults: { sceneName: 'Scène' },
      tile: { label: 'Changer de scène', icon: 'window' },
      run: (api: Controller, input) => api.request('SetCurrentProgramScene', input),
      feedback: (api) =>
        api.state.pipe(Effect.as({ icon: 'window', text: 'PRÊT', tone: 'neutral' } as const)),
      unavailable: { icon: 'window', text: 'HORS LIGNE', tone: 'neutral' },
    }),
    Plugin.action({
      id: 'mute-input',
      name: 'Mute d’une source',
      description: 'Bascule le mute de la source audio OBS.',
      input: Schema.Struct({
        inputName: Schema.NonEmptyString.annotate({ title: 'Source audio' }),
      }),
      defaults: { inputName: 'Mic/Aux' },
      tile: { label: 'Mute source OBS', icon: 'microphone' },
      run: (api: Controller, input) => api.request('ToggleInputMute', input),
      feedback: (api) =>
        api.state.pipe(Effect.as({ icon: 'microphone', text: 'PRÊT', tone: 'neutral' } as const)),
      unavailable: { icon: 'microphone', text: 'HORS LIGNE', tone: 'neutral' },
    }),
  ],
});
