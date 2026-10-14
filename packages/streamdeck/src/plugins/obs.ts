import * as Rpc from '@nixfiles/system-control/obs-rpc.ts';
import {
  Obs as SystemObs,
  type Controller as SystemController,
} from '@nixfiles/system-control/obs.ts';
import { Context, Effect, Layer, Option, Schema } from 'effect';
import * as Plugin from '../plugin.ts';
import * as AppTiles from './application-tiles.ts';
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
const simple = (id: string, name: string, description: string, request: string) =>
  Plugin.action({
    id,
    name,
    description,
    input: empty,
    defaults: {},
    run: (api: Controller) => api.request(request),
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
    ),
    simple(
      'stream',
      'Diffusion',
      'Démarre ou arrête la diffusion lors de l’appui.',
      'ToggleStream',
    ),
    simple(
      'virtual-camera',
      'Caméra virtuelle',
      'Démarre ou arrête la caméra virtuelle.',
      'ToggleVirtualCam',
    ),
    simple(
      'save-replay',
      'Sauver le replay',
      'Sauve le replay si le buffer est déjà actif.',
      'SaveReplayBuffer',
    ),
    Plugin.action({
      id: 'scene',
      name: 'Changer de scène',
      description: 'Sélectionne la scène du programme.',
      input: Schema.Struct({ sceneName: Schema.NonEmptyString.annotate({ title: 'Scène' }) }),
      defaults: { sceneName: 'Scène' },
      run: (api: Controller, input) => api.request('SetCurrentProgramScene', input),
    }),
    Plugin.action({
      id: 'mute-input',
      name: 'Mute d’une source',
      description: 'Bascule le mute de la source audio OBS.',
      input: Schema.Struct({
        inputName: Schema.NonEmptyString.annotate({ title: 'Source audio' }),
      }),
      defaults: { inputName: 'Mic/Aux' },
      run: (api: Controller, input) => api.request('ToggleInputMute', input),
    }),
  ],
});
