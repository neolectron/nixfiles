import { Equal } from 'effect';
import { invariant } from '../src/errors.ts';
import type {
  Catalogue,
  Snapshot,
  Profile,
  ButtonBinding,
  Organize,
  Navigate,
} from '../src/studio-contract.ts';
import * as Layout from '../src/studio-layout.ts';
import { bindingOf, draftOf, type Draft } from './key-draft.ts';
import type * as LcdLayout from '../src/lcd-layout.ts';
type Key = Snapshot['keys'][number];
type Form = {
  readonly id: string;
  readonly address: string;
  readonly index: number;
  readonly value: Draft;
};
export type ProfileDraft = {
  readonly session: string;
  readonly baseline: Snapshot['configuration'];
  readonly profile: Profile;
  readonly navigation: Layout.Navigation;
  readonly forms: ReadonlyArray<Form>;
  readonly lcdNavigation?: LcdLayout.Navigation;
};
export const begin = (snapshot: Snapshot): ProfileDraft => ({
  session: snapshot.sessionId,
  baseline: snapshot.configuration,
  profile: snapshot.configuration.profile,
  navigation: snapshot.configuration.navigation,
  forms: [],
});
export const dirty = (state: ProfileDraft) =>
  state.forms.length > 0 ||
  !Equal.equals(state.profile, state.baseline.profile) ||
  !Equal.equals(state.navigation, state.baseline.navigation);
const findForm = (state: ProfileDraft, key: Key) =>
  state.forms.find((form) => form.id === key.id || form.address === key.address);
export const formOf = (state: ProfileDraft, key: Key, catalogue: Catalogue): Draft =>
  findForm(state, key)?.value ?? draftOf(key.binding, catalogue);
export const edit = (
  state: ProfileDraft,
  key: Key,
  value: Draft,
  catalogue: Catalogue,
  id: string,
): ProfileDraft => {
  const previous = findForm(state, key);
  const slot = [...Layout.project(state.profile, state.navigation, 0).keys.values()].find(
    (candidateSlot) =>
      candidateSlot.entry?.id === (previous?.id ?? key.id) ||
      candidateSlot.address === (previous?.address ?? key.address),
  );
  const forms = state.forms.filter((form) => form !== previous);
  if (Equal.equals(value, draftOf(slot?.entry?.binding ?? null, catalogue)))
    return { ...state, forms };
  return {
    ...state,
    forms: [
      ...forms,
      {
        id: previous?.id ?? key.id ?? id,
        address: previous?.address ?? key.address,
        index: key.index,
        value,
      },
    ],
  };
};
/** Delete only the addressed shortcut, including an incomplete local form. */
export const remove = (state: ProfileDraft, key: Key, catalogue: Catalogue): ProfileDraft => {
  if (key.overlay || key.navigation || key.status === 'running' || key.pressed)
    throw new Error('Cette touche ne peut pas être supprimée maintenant.');
  const preview = materialize(state, catalogue, false);
  const slot = Layout.project(preview.profile, state.navigation, 0).keys.get(key.index);
  if (!slot || slot.virtual || slot.address !== key.address || (slot.entry?.id ?? null) !== key.id)
    throw new Error('La page ou la touche a changé. Recommence la suppression.');
  const form = findForm(state, key);
  if (!slot.entry && !form) return state;
  return edit(
    state,
    key,
    draftOf(null, catalogue),
    catalogue,
    key.id ?? invariant(form, 'profile-draft').id,
  );
};
/** Resolve all form locations before writing, so removing a fixed key cannot retarget another form. */
export const materialize = (
  state: ProfileDraft,
  catalogue: Catalogue,
  strict = true,
): ProfileDraft => {
  const profile = Layout.copy(state.profile);
  const projection = Layout.project(profile, state.navigation, 0);
  for (const form of state.forms) {
    try {
      const located = [...projection.keys].find(
        ([, slot]) => slot.entry?.id === form.id || slot.address === form.address,
      );
      if (!located || located[1].virtual) throw new Error('Cette touche a changé de page.');
      const [index, slot] = located;
      const binding = bindingOf(form.value, catalogue);
      const entry = binding ? { ...slot.entry, id: form.id, binding } : null;
      const zone = invariant(
        profile.zones.find((candidateZone) => candidateZone.id === slot.zone),
        'profile-draft',
      );
      if (slot.pinned) {
        if (entry) zone.pinned[String(index)] = entry;
        else delete zone.pinned[String(index)];
      } else {
        const items = Layout.container(
          profile,
          zone.id,
          Layout.position(state.navigation, zone.id).folder,
        ).items as Array<{ id: string; binding: ButtonBinding } | null>;
        while (items.length <= invariant(slot.slot, 'profile-draft')) items.push(null);
        items[invariant(slot.slot, 'profile-draft')] = entry;
      }
    } catch (error) {
      if (strict)
        throw new Error(
          `Touche ${form.index + 1} : ${error instanceof Error ? error.message : 'Paramètres invalides.'}`,
          { cause: error },
        );
    }
  }
  return { ...state, profile, forms: strict ? [] : state.forms };
};
export const organize = (
  state: ProfileDraft,
  catalogue: Catalogue,
  command: Organize,
  ids: { entry: string; folder: string; zone: string },
  keys: ReadonlyArray<number>,
): ProfileDraft => {
  const prepared = materialize(state, catalogue);
  const profile = Layout.copy(prepared.profile);
  const navigation = Layout.organize(profile, prepared.navigation, command, ids);
  Layout.validate(profile, keys);
  return { ...prepared, profile, navigation };
};
export const navigate = (
  state: ProfileDraft,
  catalogue: Catalogue,
  command: Navigate,
): ProfileDraft => {
  const prepared = materialize(state, catalogue);
  return {
    ...prepared,
    navigation: Layout.navigate(prepared.profile, prepared.navigation, command),
  };
};
export const editGestures = (
  state: ProfileDraft,
  catalogue: Catalogue,
  key: Key,
  gestures: NonNullable<Key['gestures']>,
): ProfileDraft => {
  const prepared = materialize(state, catalogue);
  const profile = Layout.copy(prepared.profile);
  const slot = Layout.project(profile, prepared.navigation, 0).keys.get(key.index);
  if (!slot?.entry || slot.virtual || key.overlay)
    throw new Error('Cette touche ne peut pas être modifiée.');
  Layout.replace(profile, prepared.navigation, key.index, { ...slot.entry, gestures });
  return { ...prepared, profile };
};
const keyIdentity = (key: Key | undefined) =>
  key && [
    key.id,
    key.address,
    key.zone,
    key.pinned,
    key.navigation,
    key.binding,
    key.gestures,
    key.overlay,
  ];
/** Only configuration identity matters; live feedback, presses and counters remain usable. */
export const pendingKeys = (
  state: ProfileDraft,
  preview: Snapshot,
  live: Snapshot,
): ReadonlySet<number> => {
  if (!dirty(state)) return new Set();
  return new Set(
    preview.keys
      .filter(
        (key) =>
          state.session !== live.sessionId ||
          !!findForm(state, key) ||
          !Equal.equals(
            keyIdentity(key),
            keyIdentity(live.keys.find((current) => current.index === key.index)),
          ),
      )
      .map((key) => key.index),
  );
};
/** Draft keys render locally; only committed snapshots drive actual input and hardware images. */
export const project = (
  state: ProfileDraft,
  live: Snapshot,
  catalogue: Catalogue | undefined,
): Snapshot => {
  if (!dirty(state)) return live;
  const preview = catalogue ? materialize(state, catalogue, false) : state;
  const projected = Layout.project(preview.profile, preview.navigation, live.layout.revision);
  const committed = Layout.project(
    live.configuration.profile,
    live.configuration.navigation,
    live.layout.revision,
  );
  return {
    ...live,
    configuration: { ...live.configuration, profile: preview.profile },
    ...(state.lcdNavigation && live.lcdLayout
      ? { lcdLayout: { ...live.lcdLayout, navigation: state.lcdNavigation } }
      : {}),
    layout: projected.layout,
    keys: live.keys.map((key) => {
      const slot = invariant(projected.keys.get(key.index), 'profile-draft');
      if (Equal.equals(slot, committed.keys.get(key.index))) return key;
      const running = live.keys.find((current) => slot.entry && current.id === slot.entry.id);
      const same = Equal.equals(running?.binding ?? null, slot.entry?.binding ?? null);
      const binding = slot.entry?.binding;
      const info =
        binding?.action === 'plugin'
          ? catalogue?.pluginActions.find(
              (action) =>
                action.plugin === binding.parameters.plugin &&
                action.id === binding.parameters.command,
            )
          : undefined;
      return {
        ...key,
        overlay: undefined,
        id: slot.entry?.id ?? null,
        address: slot.address,
        zone: slot.zone,
        pinned: slot.pinned,
        navigation: slot.virtual,
        binding: slot.entry?.binding ?? null,
        gestures: slot.entry?.gestures ?? {},
        count:
          same && running
            ? running.count
            : slot.entry?.binding.action === 'counter'
              ? slot.entry.binding.parameters.start
              : 0,
        status: same && running ? running.status : 'idle',
        detail: same && running ? running.detail : '',
        feedback:
          same && running
            ? running.feedback
            : info?.tile
              ? { icon: info.tile.icon, text: '', tone: 'neutral' }
              : null,
      };
    }),
  };
};
