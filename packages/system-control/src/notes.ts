import { Id, Note, Update, appendText } from './notes-contract.ts';
import {
  Context,
  Crypto,
  Data,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Path,
  Schema,
  Semaphore,
} from 'effect';

export class NoteError extends Data.TaggedError('NoteError')<{
  readonly message: string;
  readonly status: number;
}> {}
export const make = (directory: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const lock = yield* Semaphore.make(1);
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
                status: 500,
              }),
        ),
      );
    const file = (id: string) =>
      Schema.decodeUnknownEffect(Id)(id).pipe(
        Effect.mapError(
          () => new NoteError({ message: 'Identifiant de note invalide.', status: 400 }),
        ),
        Effect.map((key) => path.join(directory, `${key}.json`)),
      );
    const read = (id: string) =>
      Effect.gen(function* () {
        const target = yield* file(id);
        if (!(yield* fs.exists(target)))
          return { id, title: 'Note', body: '', revision: 0 } satisfies Note;
        if (Number((yield* fs.stat(target)).size) > 524288)
          return yield* new NoteError({ message: 'La note est trop volumineuse.', status: 413 });
        const note = yield* fs
          .readFileString(target)
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Note))));
        if (note.id !== id)
          return yield* new NoteError({ message: 'Identifiant de note incohérent.', status: 400 });
        return note;
      });
    const persist = (note: Note) =>
      Effect.gen(function* () {
        const value = yield* Schema.decodeUnknownEffect(Note)(note).pipe(
          Effect.mapError(
            () => new NoteError({ message: 'Titre ou contenu de note invalide.', status: 400 }),
          ),
        );
        const target = yield* file(note.id);
        yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
        const temporary = `${target}.${yield* crypto.randomUUIDv4()}.tmp`;
        yield* Effect.uninterruptible(
          fs
            .writeFileString(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
            .pipe(
              Effect.andThen(fs.rename(temporary, target)),
              Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.ignore)),
            ),
        );
        return value;
      });
    // Every mutation reloads the latest saved note while holding the same lock.
    const write = (id: string, update: (current: Note) => Effect.Effect<Note, unknown>) =>
      guard(Semaphore.withPermits(lock, 1)(Effect.flatMap(read(id), update)));
    return {
      read: (id: string) => guard(read(id)),
      ensure: (id: string, title: string) =>
        write(id, (current) =>
          current.revision ? Effect.succeed(current) : persist({ ...current, title, revision: 1 }),
        ),
      save: (input: typeof Update.Type) =>
        write(input.id, (current) =>
          current.revision !== input.expectedRevision
            ? Effect.fail(
                new NoteError({
                  message: 'La note a changé ailleurs. Ton brouillon est conservé.',
                  status: 409,
                }),
              )
            : persist({
                id: input.id,
                title: input.title,
                body: input.body,
                revision: current.revision + 1,
              }),
        ),
      append: (id: string, text: string) =>
        write(id, (current) =>
          text.trim()
            ? persist({
                ...current,
                body: appendText(current.body, text),
                revision: current.revision + 1,
              })
            : Effect.succeed(current),
        ),
    };
  });
export type Controller = Effect.Success<ReturnType<typeof make>>;
export class Notes extends Context.Service<Notes, Controller>()('@nixfiles/system-control/Notes') {
  static readonly layer = (directory: string) => Layer.effect(Notes, make(directory));
}
