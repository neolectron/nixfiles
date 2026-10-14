import { appendText, type Note } from '@nixfiles/system-control/notes-contract.ts';
export interface NoteDraft {
  readonly base: Note;
  readonly title: string;
  readonly body: string;
  readonly conflict: boolean;
}
export const fromNote = (base: Note): NoteDraft => ({
  base,
  title: base.title,
  body: base.body,
  conflict: false,
});
export const dirty = (draft: NoteDraft) =>
  draft.title !== draft.base.title || draft.body !== draft.base.body;
/** Dictation only appends. Merge that suffix into unsaved typing without overwriting it. */
export const receive = (draft: NoteDraft | undefined, remote: Note): NoteDraft => {
  if (!draft || !dirty(draft))
    return !draft || remote.revision >= draft.base.revision ? fromNote(remote) : draft;
  if (remote.revision <= draft.base.revision) return draft;
  if (
    !draft.conflict &&
    remote.title === draft.base.title &&
    remote.body.startsWith(draft.base.body)
  )
    return {
      ...draft,
      base: remote,
      body: appendText(draft.body, remote.body.slice(draft.base.body.length)),
      conflict: false,
    };
  return { ...draft, conflict: true };
};
