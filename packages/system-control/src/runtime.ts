import { Layer } from 'effect';
import { layer as audioLayer } from './audio.ts';
import { Spotify } from './spotify.ts';
import { MediaPlayers } from './media.ts';
import { Discord } from './discord.ts';
/** Compose once at the application's root scope; every consumer gets these shared instances. */
export const integrationsLayer = Layer.mergeAll(Spotify.layer, MediaPlayers.layer, Discord.layer);
export const layer = Layer.merge(audioLayer, integrationsLayer);
