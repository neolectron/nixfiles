import { Context, Effect, Layer, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { Notes } from '@nixfiles/system-control/notes.ts';
import { Id } from '@nixfiles/system-control/notes-contract.ts';
import { Speech } from '@nixfiles/system-control/speech.ts';
import { IntegrationError } from '@nixfiles/system-control/errors.ts';
import * as Plugin from '../plugin.ts';

export class NoteOpener extends Context.Service<
  NoteOpener,
  { readonly open: (id: string) => Effect.Effect<void, IntegrationError> }
>()('@nixfiles/streamdeck/NoteOpener') {}
export const opener = (origin: string) =>
  Effect.gen(function* () {
    const processes = yield* ChildProcessSpawner.ChildProcessSpawner;
    return {
      open: (id: string) =>
        Effect.scoped(
          Effect.gen(function* () {
            const url = new URL('/', origin);
            url.searchParams.set('note', id);
            const handle = yield* processes.spawn(
              ChildProcess.make('gio', ['open', url.href], { stdin: 'ignore' }),
            );
            yield* handle.unref;
            const [code] = yield* Effect.all(
              [handle.exitCode, Stream.runDrain(handle.stdout), Stream.runDrain(handle.stderr)],
              { concurrency: 'unbounded' },
            );
            if (code !== 0)
              return yield* new IntegrationError({ message: 'Ouverture de la note impossible.' });
          }),
        ).pipe(
          Effect.timeout('3 seconds'),
          Effect.mapError(
            () => new IntegrationError({ message: 'Ouverture de la note impossible.' }),
          ),
        ),
    };
  });
export class NoteActions extends Context.Service<
  NoteActions,
  {
    readonly notes: typeof Notes.Service;
    readonly speech: typeof Speech.Service;
    readonly opener: typeof NoteOpener.Service;
  }
>()('@nixfiles/streamdeck/NoteActions') {
  static readonly layer = Layer.effect(
    NoteActions,
    Effect.gen(function* () {
      return { notes: yield* Notes, speech: yield* Speech, opener: yield* NoteOpener };
    }),
  );
}
export const action = Plugin.action({
  id: 'note',
  name: 'Ouvrir / dicter une note',
  description:
    'Appui bref : ouvrir. Maintenir : dicter, puis ajouter la transcription au relâchement.',
  input: Schema.Struct({
    id: Id.annotate({
      title: 'Identifiant',
      description: 'Même identifiant : même note. Lettres minuscules, chiffres, tirets.',
    }),
    title: Schema.NonEmptyString.check(Schema.isMaxLength(160)).annotate({
      title: 'Titre initial',
    }),
  }),
  defaults: { id: 'bloc-notes', title: 'Mes notes' },
  interaction: 'hold',
  tile: { label: 'Note', icon: 'note' },
  run: (api: typeof NoteActions.Service, input, invocation) =>
    Plugin.tapOrHold(
      invocation,
      api.notes
        .ensure(input.id, input.title)
        .pipe(Effect.andThen(api.opener.open(input.id)), Effect.as('Note ouverte.')),
      (released) =>
        Effect.gen(function* () {
          yield* api.notes.ensure(input.id, input.title);
          yield* invocation.output('Micro actif pendant l’appui.');
          const text = yield* api.speech.capture(input.id, released);
          yield* api.notes.append(input.id, text);
          return text.trim() ? 'Dictée ajoutée à la note.' : 'Aucune parole détectée.';
        }),
    ),
  feedback: (api: typeof NoteActions.Service, input) =>
    Effect.map(api.speech.activity, (state) => ({
      icon:
        state.target === input.id && state.phase === 'recording'
          ? ('microphone' as const)
          : ('note' as const),
      tone:
        state.target === input.id && state.phase !== 'idle'
          ? ('positive' as const)
          : ('neutral' as const),
      text:
        state.target !== input.id || state.phase === 'idle'
          ? 'OUVRIR / DICTER'
          : state.phase === 'recording'
            ? 'ÉCOUTE'
            : 'TRANSCRIPTION',
    })),
});
export const plugin = Plugin.fromLayer({
  id: 'notes',
  name: 'Notes',
  description: 'Notes locales et dictée avec Handy.',
  controls: {},
  service: NoteActions,
  layer: NoteActions.layer,
  actions: [action],
});
