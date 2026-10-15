import { invariant } from './errors.ts';
import type { Entry, Profile } from './studio-contract.ts';
/** Preserve IDs, labels, positions, input and folder/pagination structure. */
const mergeActions = (
  profile: Profile,
  previous: string,
  next: string,
  command: string,
): Profile => {
  const oldAction = (entry: Entry | null) =>
    entry?.binding.action === 'plugin' &&
    entry.binding.parameters.plugin === previous &&
    entry.binding.parameters.command === command;
  const entries = [
    ...profile.zones.flatMap((zone) => [...zone.items, ...Object.values(zone.pinned)]),
    ...profile.folders.flatMap((folder) => folder.items),
  ];
  if (!entries.some(oldAction)) return profile;
  const rename = (entry: Entry | null): Entry | null =>
    oldAction(entry) && entry?.binding.action === 'plugin'
      ? {
          ...entry,
          binding: {
            ...entry.binding,
            parameters: { ...entry.binding.parameters, plugin: next },
          },
        }
      : entry;
  return {
    ...profile,
    zones: profile.zones.map((zone) => ({
      ...zone,
      items: zone.items.map(rename),
      pinned: Object.fromEntries(
        Object.entries(zone.pinned).map(([key, entry]) => [
          key,
          invariant(rename(entry), 'studio-profile-migrations'),
        ]),
      ),
    })),
    folders: profile.folders.map((folder) => ({ ...folder, items: folder.items.map(rename) })),
  };
};
export const mergeDiscordActions = (profile: Profile) =>
  mergeActions(profile, 'discord-screen-share', 'discord', 'share-screen');
export const mergeOpenAIActions = (profile: Profile) =>
  mergeActions(profile, 'dot-voice', 'openai-apps', 'talk');
/** Remove the obsolete toggle so disabling Discord stays disabled after restart. */
const mergePreferences = (
  enabled: Readonly<Record<string, boolean>>,
  previous: string,
  next: string,
): Readonly<Record<string, boolean>> => {
  if (!Object.hasOwn(enabled, previous)) return enabled;
  const { [previous]: old, ...rest } = enabled;
  return { ...rest, [next]: (rest[next] ?? false) || (old ?? false) };
};
export const mergeDiscordPreferences = (enabled: Readonly<Record<string, boolean>>) =>
  mergePreferences(enabled, 'discord-screen-share', 'discord');
export const mergeOpenAIPreferences = (enabled: Readonly<Record<string, boolean>>) =>
  mergePreferences(enabled, 'dot-voice', 'openai-apps');
