import { Layer } from 'effect';
import { layer as audioLayer } from './audio.ts';
import { Spotify } from './spotify.ts';
import { MediaPlayers } from './media.ts';
import { Discord } from './discord.ts';
import { Desktop } from './desktop.ts';
import { Obs } from './obs.ts';
import { MprisRegistry } from './mpris-registry.ts';
import { SystemAppearance } from './appearance.ts';
import { DotCall } from './dot-call.ts';
import { CodexPrompt } from './codex-prompt.ts';
import { TextTransform } from './text-transform.ts';
/** Compose once at the application's root scope; every consumer gets these shared instances. */
export const integrationsLayer = Layer.mergeAll(
  Spotify.layer,
  MediaPlayers.layer,
  Discord.layer,
  Desktop.layer,
  Obs.layer,
  SystemAppearance.layer,
  DotCall.layer,
  CodexPrompt.layer,
  TextTransform.layer,
).pipe(Layer.provideMerge(MprisRegistry.layer));
export const layer = Layer.merge(audioLayer, integrationsLayer);
