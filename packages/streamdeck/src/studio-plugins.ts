import { Effect } from 'effect';
import type { make } from './plugin-host.ts';
import * as Obs from './plugins/obs.ts';
import * as Discord from './plugins/discord.ts';
import * as Spotify from './plugins/spotify.ts';
import * as Media from './plugins/media.ts';
import * as OpenAIApps from './plugins/openai-apps.ts';
import * as Appearance from './plugins/appearance.ts';
import * as NotesPlugin from './plugins/notes.ts';
import * as System from './plugins/system.tsx';

/** Register personal plugins here. New plugins start disabled unless saved otherwise. */
export const configure = (host: Effect.Success<typeof make>) =>
  Effect.gen(function* () {
    yield* host.install(Obs.plugin);
    yield* host.install(Discord.plugin);
    yield* host.install(Spotify.plugin);
    yield* host.install(Media.plugin);
    yield* host.install(OpenAIApps.plugin);
    yield* host.install(Appearance.plugin);
    yield* host.install(NotesPlugin.plugin);
    yield* host.install(System.plugin);
  });
