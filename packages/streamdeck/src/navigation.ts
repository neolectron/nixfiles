import { Context, type Effect, Option, Schema } from 'effect';
import type { StudioError } from './studio-errors.ts';

export const Command = Schema.Struct({
  surface: Schema.Literals(['keys', 'lcd', 'audio']),
  zone: Schema.String,
  operation: Schema.Literals(['next', 'previous', 'open', 'back', 'root']),
  folder: Schema.String,
});
export type Command = typeof Command.Type;
export interface Controller {
  readonly navigate: (command: Command, currentZone?: string) => Effect.Effect<void, StudioError>;
}
/** Navigation is a presentation service; it never belongs to system-control. */
export class Navigation extends Context.Service<Navigation, Controller>()(
  '@nixfiles/streamdeck/Navigation',
) {}

/** Shared declarative navigation for runtime and draft previews, including legacy profiles. */
export const commandFor = (tile: {
  plugin: string;
  action: string;
  input: unknown;
}): Command | undefined => {
  if (tile.plugin === 'navigation' && tile.action === 'navigate')
    return Option.getOrUndefined(Schema.decodeUnknownOption(Command)(tile.input));
  const legacy: Readonly<Record<string, Command['operation']>> = {
    'lcd-next': 'next',
    'lcd-previous': 'previous',
    'lcd-back': 'back',
    'lcd-folder': 'open',
  };
  const operation = tile.plugin === 'system' ? legacy[tile.action] : undefined;
  if (!operation || typeof tile.input !== 'object' || tile.input === null) return undefined;
  const input = tile.input as Record<string, unknown>;
  return {
    surface: 'lcd',
    zone: typeof input.zone === 'string' ? input.zone : 'current',
    operation,
    folder: typeof input.folder === 'string' ? input.folder : '',
  };
};
