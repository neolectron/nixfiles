import { Effect, Option } from 'effect';
import { ActionCatalog } from '@nixfiles/system-control/actions.ts';

/** Studio uses the shared system catalogue; standalone scripts retain their injected service. */
export const invoke = <A, E, R>(id: string, input: unknown, fallback: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const actions = yield* Effect.serviceOption(ActionCatalog);
    return Option.isSome(actions) ? yield* actions.value.invoke(id, input) : yield* fallback;
  });
