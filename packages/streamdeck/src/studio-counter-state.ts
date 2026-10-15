import { Effect, Option, Schema } from 'effect';
import { PersistentState } from '@nixfiles/system-control/persistent-state.ts';
import { StudioError } from './studio-errors.ts';
import { invariant } from './errors.ts';

const Counters = Schema.Record(
  Schema.String,
  Schema.Struct({ start: Schema.Int, count: Schema.Int }),
);
type Counters = typeof Counters.Type;
const value = (counters: Counters, id: string, start: number) =>
  counters[id]?.start === start ? counters[id].count : start;
const failure = () =>
  new StudioError({ message: 'Lecture ou sauvegarde du compteur impossible.', status: 500 });

/** Runtime values use stable entry IDs; moving or renaming a tile never resets its counter. */
export const make = (key: string) =>
  Effect.gen(function* () {
    const document = (yield* PersistentState).document(key, Counters);
    const initial = Option.getOrElse(
      yield* document.get.pipe(Effect.mapError(failure)),
      () => ({}),
    );
    const update = (id: string, start: number, increment: boolean) =>
      document
        .modify((before) => {
          const counters = Option.getOrElse(before, () => ({}));
          return Effect.succeed({
            ...counters,
            [id]: { start, count: increment ? value(counters, id, start) + 1 : start },
          });
        })
        .pipe(
          Effect.map((counters) => invariant(counters[id], 'studio-counter-state').count),
          Effect.mapError(failure),
        );
    return {
      initial: (id: string, start: number) => value(initial, id, start),
      increment: (id: string, start: number) => update(id, start, true),
      reset: (id: string, start: number) => update(id, start, false),
    };
  });
