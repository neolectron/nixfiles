import { Effect, Option } from 'effect';
import * as Counters from '@nixfiles/system-control/counters.ts';
import { StudioError } from './studio-errors.ts';
const failure = () =>
  new StudioError({ message: 'Lecture ou sauvegarde du compteur impossible.', status: 500 });
/** Presentation boundary: persistence and counter semantics belong to the system service. */
export const make = (key: string) =>
  Effect.gen(function* () {
    const shared = yield* Effect.serviceOption(Counters.Counters);
    const api = Option.isSome(shared)
      ? shared.value
      : yield* Counters.make(key).pipe(Effect.mapError(failure));
    return {
      ...api,
      increment: (...args: Parameters<typeof api.increment>) =>
        api.increment(...args).pipe(Effect.mapError(failure)),
    };
  });
