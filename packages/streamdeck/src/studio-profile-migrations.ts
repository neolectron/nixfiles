import { invariant } from './errors.ts';
import type { Entry, Profile } from './studio-contract.ts';
const previous = 'discord-screen-share';
const oldAction = (entry: Entry | null) =>
  entry?.binding.action === 'plugin' &&
  entry.binding.parameters.plugin === previous &&
  entry.binding.parameters.command === 'share-screen';
/** Preserve IDs, labels, positions, input and folder/pagination structure. */
export const mergeDiscordActions = (profile: Profile): Profile => {
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
            parameters: { ...entry.binding.parameters, plugin: 'discord' },
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
/** Remove the obsolete toggle so disabling Discord stays disabled after restart. */
export const mergeDiscordPreferences = (
  enabled: Readonly<Record<string, boolean>>,
): Readonly<Record<string, boolean>> => {
  if (!Object.hasOwn(enabled, previous)) return enabled;
  const { [previous]: share, ...rest } = enabled;
  return { ...rest, discord: (rest.discord ?? false) || (share ?? false) };
};
