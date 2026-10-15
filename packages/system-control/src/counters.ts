import { Context, Effect, Layer, Option, Schema } from 'effect';
import { PersistentState } from './persistent-state.ts';
import { IntegrationError, invariant } from './errors.ts';

const Values = Schema.Record(
  Schema.String,
  Schema.Struct({
    start: Schema.Int,
    count: Schema.Int,
    version: Schema.optionalKey(Schema.String),
  }),
);
const failure = () =>
  new IntegrationError({ message: 'Lecture ou sauvegarde du compteur impossible.' });
export const make = (key: string) =>
  Effect.gen(function* () {
    const document = (yield* PersistentState).document(key, Values);
    let cached = Option.getOrElse(
      yield* document.get.pipe(Effect.mapError(failure)),
      () => ({}) as typeof Values.Type,
    );
    const current = (id: string, start: number, version?: string) =>
      cached[id]?.start === start && cached[id]?.version === version ? cached[id].count : start;
    const increment = (id: string, start: number, version?: string) =>
      document
        .modify((before) => {
          const values = Option.getOrElse(before, () => ({}) as typeof Values.Type);
          const previous = values[id];
          const count =
            previous?.start === start && previous.version === version ? previous.count : start;
          return Effect.succeed({
            ...values,
            [id]: { start, count: count + 1, ...(version ? { version } : {}) },
          });
        })
        .pipe(
          Effect.tap((values) =>
            Effect.sync(() => {
              cached = values;
            }),
          ),
          Effect.map((values) => invariant(values[id], 'counter').count),
          Effect.mapError(failure),
        );
    return { initial: current, increment };
  });
export type Controller = Effect.Success<ReturnType<typeof make>>;
export class Counters extends Context.Service<Counters, Controller>()(
  '@nixfiles/system-control/Counters',
) {
  static readonly layer = (key: string) => Layer.effect(Counters, make(key));
}
