import { Context, Effect, Layer, Schema } from 'effect';
import { DesktopIcons } from '@nixfiles/system-control/desktop-icons.ts';
import type { Controller as Desktop } from '@nixfiles/system-control/desktop.ts';
import * as Plugin from '../plugin.ts';
import { LcdSurface, type Controller as Surface } from '../lcd-surface.tsx';
import * as Applications from './application-tiles.ts';
import * as Takumi from '../takumi.ts';
import { PresentationAssets } from '../presentation-assets.ts';
import { WindowCard, presentation } from './system-presentation.tsx';
import * as Icons from './system-icons.ts';
type Api = {
  desktop: Desktop;
  surface: Surface;
  icon: (name: string) => Effect.Effect<string | undefined>;
  renderer: Effect.Success<typeof Takumi.make>;
  assets: typeof PresentationAssets.Service;
};
export const activeWindow = Plugin.action({
  id: 'active-window',
  name: 'Fenêtre active',
  description: 'Titre et icône de la fenêtre qui a le focus.',
  input: Plugin.NoInput,
  defaults: {},
  tile: { label: 'Fenêtre active', icon: 'window', surfaces: ['lcd'], width: 400 },
  run: () => Effect.void,
  lcd: (api: Api, _input, size) =>
    Effect.gen(function* () {
      const focused = yield* api.desktop.focused.pipe(Effect.orElseSucceed(() => null));
      const identity = focused?.app_id?.toLowerCase();
      const application = identity
        ? api.desktop.applications.find((app) =>
            [app.id.replace(/\.desktop$/, ''), app.windowClass].some(
              (name) => name?.toLowerCase() === identity,
            ),
          )
        : undefined;
      const data = application?.icon ? yield* api.icon(application.icon) : undefined;
      const url = yield* api.assets.publish(data);
      const value = {
        ...size,
        application: application?.name ?? focused?.app_id ?? '',
        title: focused?.title ?? '',
        icon: url ?? null,
      };
      const view = yield* presentation.describe(value);
      return {
        view,
        stamp: JSON.stringify(view),
        draw: api.renderer.rgb(<WindowCard value={{ ...value, icon: data ?? null }} />, size),
      };
    }),
});
const zone = Schema.String.annotate({
  title: 'Zone LCD',
  contentMediaType: 'application/x-streamdeck-lcd-zone',
  description: 'Identifiant de la zone, ou « current » pour la zone de cette tile.',
});
const page = (operation: 'next' | 'previous' | 'back') =>
  Plugin.action({
    id: `lcd-${operation}`,
    name:
      operation === 'back'
        ? 'Retour LCD'
        : operation === 'next'
          ? 'Page LCD suivante'
          : 'Page LCD précédente',
    description: 'Navigue uniquement dans la zone LCD ciblée.',
    input: Schema.Struct({ zone }),
    defaults: { zone: 'current' },
    tile: {
      label: operation === 'back' ? 'Retour LCD' : operation === 'next' ? 'LCD →' : 'LCD ←',
      icon: operation === 'next' ? 'next' : 'previous',
      width: 100,
    },
    run: (api: Api, input, context) =>
      api.surface.navigate({
        zone: input.zone === 'current' ? (context.surface?.zone ?? 'current') : input.zone,
        operation,
      }),
  });
export const folder = Plugin.action({
  id: 'lcd-folder',
  name: 'Dossier LCD',
  description: 'Ouvre un dossier dans la zone LCD choisie.',
  input: Schema.Struct({
    zone,
    folder: Schema.String.annotate({
      title: 'Dossier LCD',
      contentMediaType: 'application/x-streamdeck-lcd-folder',
      description: 'Nom ou identifiant du dossier.',
    }),
  }),
  defaults: { zone: 'current', folder: '' },
  tile: { label: 'Dossier LCD', icon: 'folder', width: 120 },
  run: (api: Api, input, context) =>
    api.surface.navigate({
      zone: input.zone === 'current' ? (context.surface?.zone ?? 'current') : input.zone,
      operation: 'open',
      folder: input.folder,
    }),
});
export const plugin = Plugin.define({
  id: 'system',
  name: 'Système',
  description: 'Fenêtre active et navigation des surfaces du bureau.',
  controls: {},
  // Keep legacy action IDs executable; new navigation presets belong to the Navigation plugin.
  tiles: [
    {
      id: 'active-window',
      action: 'active-window',
      label: 'Fenêtre active',
      icon: 'window',
      surfaces: ['lcd'],
      width: 400,
      input: {},
    },
  ],
  actions: [activeWindow, page('previous'), page('next'), folder, page('back')],
  setup: Effect.gen(function* () {
    const api: Api = {
      desktop: yield* Applications.desktop,
      surface: yield* LcdSurface,
      icon: yield* Icons.make(Context.get(yield* Layer.build(DesktopIcons.layer), DesktopIcons)),
      renderer: yield* Takumi.current,
      assets: yield* PresentationAssets,
    };
    return { api };
  }),
});
