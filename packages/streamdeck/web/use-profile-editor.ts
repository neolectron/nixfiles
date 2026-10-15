import { useEffect, useRef, useState } from 'react';
import { invariant } from '../src/errors.ts';
import { Effect } from 'effect';
import type { Catalogue, Snapshot, Organize, Navigate } from '../src/studio-contract.ts';
import * as Drafts from './profile-draft.ts';
import type { Draft } from './key-draft.ts';
import * as Api from './api.ts';
import * as LcdLayout from '../src/lcd-layout.ts';

export function useProfileEditor(
  live: Snapshot | undefined,
  catalogue: Catalogue | undefined,
  onSnapshot: (snapshot: Snapshot) => void,
) {
  const [state, setState] = useState<Drafts.ProfileDraft | null>(null);
  const current = useRef(state);
  current.current = state;
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState('');
  const replace = (next: Drafts.ProfileDraft) => {
    current.current = next;
    setState(next);
  };
  useEffect(() => {
    if (live && (!current.current || !Drafts.dirty(current.current))) replace(Drafts.begin(live));
  }, [live]);
  const dirty = state ? Drafts.dirty(state) : false;
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    if (dirty) window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const local = (
    change: (before: Drafts.ProfileDraft, catalogue: Catalogue) => Drafts.ProfileDraft,
  ) =>
    Effect.try({
      try: () => {
        if (!current.current || !live || !catalogue || saving.current)
          throw new Error('L’éditeur n’est pas disponible.');
        const next = change(current.current, catalogue);
        replace(next);
        setError('');
        return Drafts.project(next, live, catalogue);
      },
      catch: (cause) => cause,
    });
  const save = async () => {
    if (!current.current || !catalogue || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      const prepared = await Api.run(
        Effect.try({
          try: () => Drafts.materialize(invariant(current.current, 'profile-editor'), catalogue),
          catch: (cause) => cause,
        }),
      );
      const next = await Api.run(
        Api.saveProfile({
          profile: prepared.profile,
          navigation: prepared.navigation,
          expectedRevision: prepared.baseline.revision,
          expectedProfile: prepared.baseline.profile,
          sessionId: prepared.session,
        }),
      );
      replace(Drafts.begin(next));
      onSnapshot(next);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'La configuration n’a pas pu être enregistrée.',
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const snapshot = live && state ? Drafts.project(state, live, catalogue) : live;
  return {
    state,
    dirty,
    busy,
    error,
    snapshot,
    pendingKeys:
      live && state && snapshot ? Drafts.pendingKeys(state, snapshot, live) : new Set<number>(),
    conflict: !!(
      live &&
      state &&
      dirty &&
      (state.session !== live.sessionId || state.baseline.revision !== live.configuration.revision)
    ),
    edit: (key: Snapshot['keys'][number], value: Draft) => {
      if (current.current && catalogue && !saving.current && !key.overlay)
        replace(Drafts.edit(current.current, key, value, catalogue, crypto.randomUUID()));
    },
    form: (key: Snapshot['keys'][number]) =>
      state && catalogue ? Drafts.formOf(state, key, catalogue) : undefined,
    gestures: (
      key: Snapshot['keys'][number],
      gestures: NonNullable<Snapshot['keys'][number]['gestures']>,
    ) => local((before, actions) => Drafts.editGestures(before, actions, key, gestures)),
    remove: (key: Snapshot['keys'][number]) =>
      local((before, actions) => Drafts.remove(before, key, actions)),
    editLcd: (lcd: LcdLayout.Configuration) => {
      if (current.current && !saving.current)
        replace({ ...current.current, profile: { ...current.current.profile, lcd } });
    },
    editContexts: (contexts: NonNullable<Snapshot['configuration']['profile']['contexts']>) => {
      if (current.current && !saving.current)
        replace({ ...current.current, profile: { ...current.current.profile, contexts } });
    },
    navigateLcd: (command: LcdLayout.Command) => {
      if (!current.current || saving.current) return;
      if (Drafts.dirty(current.current)) {
        try {
          replace({
            ...current.current,
            lcdNavigation: LcdLayout.navigate(
              current.current.profile.lcd ?? LcdLayout.empty,
              current.current.lcdNavigation ?? live?.lcdLayout?.navigation ?? {},
              command,
            ),
          });
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      } else
        void Api.run(Api.lcdNavigate(command))
          .then(onSnapshot)
          .catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : String(cause)),
          );
    },
    organize: (command: Organize) =>
      local((before, actions) =>
        Drafts.organize(
          before,
          actions,
          command,
          { entry: crypto.randomUUID(), folder: crypto.randomUUID(), zone: crypto.randomUUID() },
          invariant(live, 'profile-editor').keys.map((key) => key.index),
        ),
      ),
    navigate: (command: Navigate) =>
      local((before, actions) => Drafts.navigate(before, actions, command)),
    save,
    discard: () => {
      if (live && !saving.current) {
        replace(Drafts.begin(live));
        setError('');
      }
    },
  };
}
