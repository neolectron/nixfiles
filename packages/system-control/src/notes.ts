import { Context, Data, Effect, Fiber, Layer, Option, Schema } from 'effect';
import { KeyValueStoreError } from 'effect/persistence/KeyValueStore';
import { Id, Note, Update, appendText } from './notes-contract.ts';
import { PersistentState } from './persistent-state.ts';
import * as FileStorage from './state-storage-file.ts';

export class NoteError extends Data.TaggedError('NoteError')<{
  readonly message: string;
  readonly status: number;
}> {}
const current = (id: string, value: Option.Option<Note>): Note =>
  Option.getOrElse(value, () => ({ id, title: 'Note', body: '', revision: 0 }));
const validate = (id: string, value: Note) =>
  value.id !== id
    ? Effect.fail(new NoteError({ message: 'Identifiant de note incohérent.', status: 400 }))
    : Schema.decodeUnknownEffect(Note)(value).pipe(
        Effect.mapError(
          () => new NoteError({ message: 'Titre ou contenu de note invalide.', status: 400 }),
        ),
      );

/** Storage-independent notes. The application provides its shared state service. */
export const makeWithState = (namespace = 'notes') =>
  Effect.gen(function* () {
    const state = yield* PersistentState;
    const owner = yield* Effect.scope;
    let closed = false;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true;
      }),
    );
    const guard = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.suspend(
        (): Effect.Effect<A, E | NoteError, R> =>
          closed
            ? Effect.fail(new NoteError({ message: 'Le service de notes est fermé.', status: 503 }))
            : Effect.acquireUseRelease(Effect.forkIn(effect, owner), Fiber.join, Fiber.interrupt),
      ).pipe(
        Effect.mapError((error) =>
          error instanceof NoteError
            ? error
            : new NoteError({
                message: 'Lecture ou sauvegarde de la note impossible.',
                status:
                  error instanceof KeyValueStoreError && error.method === 'lifecycle' ? 503 : 500,
              }),
        ),
      );
    const document = (id: string) =>
      Schema.decodeUnknownEffect(Id)(id).pipe(
        Effect.mapError(
          () => new NoteError({ message: 'Identifiant de note invalide.', status: 400 }),
        ),
        Effect.map((key) => state.document(`${namespace ? `${namespace}/` : ''}${key}.json`, Note)),
      );
    const read = (id: string) =>
      Effect.gen(function* () {
        const doc = yield* document(id);
        return yield* validate(id, current(id, yield* doc.get));
      });
    const modify = (id: string, f: (note: Note) => Effect.Effect<Note, NoteError>) =>
      guard(
        Effect.flatMap(document(id), (doc) =>
          doc.modify((value) =>
            validate(id, current(id, value)).pipe(
              Effect.flatMap(f),
              Effect.flatMap((next) => validate(id, next)),
            ),
          ),
        ),
      );
    return {
      read: (id: string) => guard(read(id)),
      ensure: (id: string, title: string) =>
        guard(
          Effect.gen(function* () {
            const before = yield* read(id);
            return before.revision
              ? before
              : yield* modify(id, (note) =>
                  Effect.succeed(note.revision ? note : { ...note, title, revision: 1 }),
                );
          }),
        ),
      save: (input: typeof Update.Type) =>
        modify(input.id, (note) =>
          note.revision !== input.expectedRevision
            ? Effect.fail(
                new NoteError({
                  message: 'La note a changé ailleurs. Ton brouillon est conservé.',
                  status: 409,
                }),
              )
            : Effect.succeed({
                id: input.id,
                title: input.title,
                body: input.body,
                revision: note.revision + 1,
              }),
        ),
      append: (id: string, text: string) =>
        text.trim()
          ? modify(id, (note) =>
              Effect.succeed({
                ...note,
                body: appendText(note.body, text),
                revision: note.revision + 1,
              }),
            )
          : guard(read(id)),
    };
  });
/** Standalone convenience preserving the existing directory-based API. */
export const make = (directory: string) =>
  Effect.gen(function* () {
    const services = yield* Layer.build(
      PersistentState.layer.pipe(Layer.provide(FileStorage.layer(directory))),
    );
    return yield* makeWithState('').pipe(Effect.provideContext(services));
  });
export type Controller = Effect.Success<ReturnType<typeof makeWithState>>;
export class Notes extends Context.Service<Notes, Controller>()('@nixfiles/system-control/Notes') {
  static readonly layer = (directory: string) => Layer.effect(Notes, make(directory));
  static readonly layerWithState = (namespace = 'notes') =>
    Layer.effect(Notes, makeWithState(namespace));
}
