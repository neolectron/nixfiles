import { Desktop, type Controller, type Target } from '@nixfiles/system-control/desktop.ts';
import { Context, Effect, Layer, Option } from 'effect';
import { IntegrationError } from '@nixfiles/system-control/errors.ts';
import * as Plugin from '../plugin.ts';

export interface Applications {
  readonly desktop?: Controller;
}
export const desktop = Effect.gen(function* () {
  const shared = yield* Effect.serviceOption(Desktop);
  return Option.isSome(shared)
    ? shared.value
    : Context.get(yield* Layer.build(Desktop.layer), Desktop);
});
interface AppTile extends Target, Plugin.Tile {
  readonly id: string;
  readonly name: string;
}
export const discord: AppTile = {
  id: 'launch',
  name: 'Ouvrir Discord',
  label: 'Discord',
  icon: 'discord',
  applications: ['discord.desktop'],
  windows: ['discord'],
};
export const spotify: AppTile = {
  id: 'launch',
  name: 'Ouvrir Spotify / Spotifast',
  label: 'Spotify',
  icon: 'spotify',
  applications: ['spotifast.desktop', 'spotify.desktop'],
  windows: ['spotifast', 'spotify'],
};
export const spotifast: AppTile = {
  id: 'launch-spotifast',
  name: 'Ouvrir Spotifast',
  label: 'Spotifast',
  icon: 'spotifast',
  applications: ['spotifast.desktop'],
  windows: ['spotifast'],
};
export const obs: AppTile = {
  id: 'launch',
  name: 'Ouvrir OBS Studio',
  label: 'OBS Studio',
  icon: 'obs',
  applications: ['com.obsproject.Studio.desktop', 'obs.desktop'],
  windows: ['obs', 'com.obsproject.Studio'],
};
export const chatgpt: AppTile = {
  id: 'chatgpt',
  name: 'Ouvrir ChatGPT',
  label: 'ChatGPT',
  icon: 'openai',
  applications: ['chatgpt.desktop'],
  windows: ['chatgpt', 'chatgpt-desktop'],
};
export const codex: AppTile = {
  id: 'codex',
  name: 'Ouvrir Codex',
  label: 'Codex',
  icon: 'openai',
  applications: ['codex-desktop.desktop', 'codex.desktop'],
  windows: ['codex-desktop', 'codex'],
};

/** Presentation adapter only: desktop discovery, focus and launch belong to the system service. */
export const launch = <Api extends Applications>(tile: AppTile) =>
  Plugin.action({
    id: tile.id,
    name: tile.name,
    description:
      'Ouvre l’application installée ou active sa fenêtre existante. La touche suit son état.',
    input: Plugin.NoInput,
    defaults: {},
    tile: { label: tile.label, icon: tile.icon },
    unavailable: { icon: tile.icon, text: 'DÉSACTIVÉ', tone: 'neutral' },
    run: (api: Api) =>
      api.desktop
        ? api.desktop.open(tile)
        : Effect.fail(new IntegrationError({ message: 'Service Desktop indisponible.' })),
    feedback: (api: Api) =>
      api.desktop
        ? api.desktop.status(tile).pipe(
            Effect.map((status) => ({
              icon: tile.icon,
              text: status.running ? 'OUVERT' : status.application ? 'FERMÉ' : 'NON INSTALLÉ',
              tone: status.running ? ('positive' as const) : ('neutral' as const),
            })),
            Effect.catch(() =>
              Effect.succeed({ icon: tile.icon, text: 'ÉTAT INCONNU', tone: 'neutral' as const }),
            ),
          )
        : Effect.succeed({ icon: tile.icon, text: 'ÉTAT INCONNU', tone: 'neutral' as const }),
  });
