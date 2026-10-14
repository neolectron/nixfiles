import { useCallback, useEffect, useRef, useState } from 'react';
import { Effect, Fiber, Schedule } from 'effect';
import type { Activity } from '@nixfiles/system-control/speech-contract.ts';
import * as Api from './api.ts';
import * as Draft from './note-draft.ts';

export function NoteEditor({ id }: { readonly id: string }) {
  const [draft, setDraft] = useState<Draft.NoteDraft>();
  const [activity, setActivity] = useState<Activity>({ target: null, phase: 'idle' });
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const body = useRef<HTMLTextAreaElement>(null);
  const changed = !!draft && Draft.dirty(draft);
  const loaded = !!draft;
  useEffect(() => {
    const fiber = Effect.runFork(
      Effect.repeat(
        Api.readNote(id).pipe(
          Effect.tap((response) =>
            Effect.sync(() => {
              if (!saving.current) setDraft((current) => Draft.receive(current, response.note));
              setActivity(response.activity);
              setReadError('');
            }),
          ),
          Effect.catch((failure) =>
            Effect.sync(() =>
              setReadError(
                failure instanceof Error ? failure.message : 'Lecture de la note impossible.',
              ),
            ),
          ),
        ),
        Schedule.spaced('1 second'),
      ),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [id]);
  useEffect(() => {
    if (loaded) body.current?.focus();
  }, [loaded]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (changed) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changed]);
  const save = useCallback(async () => {
    if (!draft || saving.current || !changed || draft.conflict) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      const note = await Api.run(
        Api.saveNote({
          id,
          title: draft.title,
          body: draft.body,
          expectedRevision: draft.base.revision,
        }),
      );
      setDraft(Draft.fromNote(note));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Sauvegarde impossible.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }, [draft, changed, id]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [save]);
  const state = activity.target === id ? activity.phase : 'idle';
  return (
    <main className="note-editor">
      <header className="note-toolbar">
        <a href="/" className="note-back" aria-label="Revenir au Stream Deck">
          ←
        </a>
        <input
          aria-label="Titre de la note"
          value={draft?.title ?? ''}
          placeholder="Note"
          maxLength={160}
          disabled={!draft || busy}
          onChange={(event) => {
            const title = event.currentTarget.value;
            setDraft((current) => current && { ...current, title });
          }}
        />
        <button
          className="primary"
          disabled={!changed || busy || !!draft?.conflict || !draft?.title.trim()}
          onClick={() => {
            void save();
          }}
        >
          Enregistrer
        </button>
      </header>
      <div className="note-meta" role="status">
        <span>
          {!draft
            ? 'Chargement…'
            : state === 'recording'
              ? '● Écoute…'
              : state === 'transcribing'
                ? 'Transcription…'
                : changed
                  ? 'Modifications non enregistrées'
                  : 'Enregistrée'}
        </span>
        <span>Ctrl S</span>
      </div>
      {error || readError || draft?.conflict ? (
        <div className="note-error" role="alert">
          {draft?.conflict
            ? 'La note a changé ailleurs. Ton brouillon est conservé.'
            : error || readError}
          {draft?.conflict ? (
            <button
              onClick={() => {
                if (window.confirm('Recharger la note et abandonner le brouillon ?')) {
                  setDraft(undefined);
                  setError('');
                }
              }}
            >
              Recharger
            </button>
          ) : null}
        </div>
      ) : null}
      <textarea
        ref={body}
        aria-label="Contenu de la note"
        placeholder="Écris ta note…"
        value={draft?.body ?? ''}
        maxLength={64000}
        disabled={!draft || busy}
        onChange={(event) => {
          const value = event.currentTarget.value;
          setDraft((current) => current && { ...current, body: value });
        }}
      />
    </main>
  );
}
