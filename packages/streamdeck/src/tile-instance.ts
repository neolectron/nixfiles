import { Schema } from 'effect';
import { ButtonBinding, Entry, GestureBindings } from './studio-contract.ts';
import { KeyTrigger } from './press-trigger.ts';
import type * as Lcd from './lcd-layout.ts';

/** Common domain model; placement and navigation are independent of action identity. */
export const ActionRef = Schema.Struct({
  plugin: Schema.NonEmptyString,
  action: Schema.NonEmptyString,
  input: Schema.Json,
});
export type ActionRef = typeof ActionRef.Type;
export const TileInstance = Schema.Struct({
  id: Schema.NonEmptyString,
  label: Schema.String,
  action: ActionRef,
  trigger: Schema.optionalKey(KeyTrigger),
  gestures: Schema.optionalKey(GestureBindings),
  stateVersion: Schema.optionalKey(Schema.NonEmptyString),
});
export type TileInstance = typeof TileInstance.Type;
export const fromKey = (entry: Entry): TileInstance => ({
  id: entry.id,
  label: entry.binding.label,
  action:
    entry.binding.action === 'plugin'
      ? Schema.decodeUnknownSync(ActionRef)({
          plugin: entry.binding.parameters.plugin,
          action: entry.binding.parameters.command,
          input: entry.binding.parameters.input,
        })
      : Schema.decodeUnknownSync(ActionRef)({
          plugin: 'shortcuts',
          action: entry.binding.action,
          input: JSON.parse(JSON.stringify(entry.binding.parameters)),
        }),
  ...(entry.binding.trigger ? { trigger: entry.binding.trigger } : {}),
  ...(entry.gestures ? { gestures: entry.gestures } : {}),
  ...(entry.stateVersion ? { stateVersion: entry.stateVersion } : {}),
});
export const fromLcd = (tile: Lcd.Tile): TileInstance => ({
  id: tile.id,
  label: tile.label,
  action: { plugin: tile.plugin, action: tile.action, input: tile.input },
});
/** Existing profile formats remain valid through these lossless adapters. */
export const toKey = (tile: TileInstance): Entry =>
  Schema.decodeUnknownSync(Entry)({
    id: tile.id,
    binding: Schema.decodeUnknownSync(ButtonBinding)({
      label: tile.label,
      ...(tile.trigger ? { trigger: tile.trigger } : {}),
      ...(tile.action.plugin === 'shortcuts'
        ? { action: tile.action.action, parameters: tile.action.input }
        : {
            action: 'plugin',
            parameters: {
              plugin: tile.action.plugin,
              command: tile.action.action,
              input: tile.action.input,
            },
          }),
    }),
    ...(tile.gestures ? { gestures: tile.gestures } : {}),
    ...(tile.stateVersion ? { stateVersion: tile.stateVersion } : {}),
  });
export const toLcd = (tile: TileInstance, width: number, application = ''): Lcd.Tile => ({
  id: tile.id,
  label: tile.label,
  ...tile.action,
  width,
  application,
});
