import { Effect, PubSub, Ref, Semaphore, Stream } from 'effect';
import type { Snapshot } from './studio-contract.ts';
import { webSnapshot } from './studio-presentation.ts';

/** One serialized materialized view for HTTP and every SSE subscriber. */
export const make = (read: Effect.Effect<Snapshot>, interval = 150) =>
  Effect.gen(function* () {
    const lock = yield* Semaphore.make(1);
    const hub = yield* Effect.acquireRelease(PubSub.sliding<Snapshot>(64), PubSub.shutdown);
    const current = yield* Ref.make<Snapshot | undefined>(undefined);
    let stamp = '';
    let revision = 0;
    const refresh = Semaphore.withPermits(
      lock,
      1,
    )(
      Effect.gen(function* () {
        const value = yield* read;
        const nextStamp = JSON.stringify(webSnapshot(value));
        if (stamp === nextStamp) {
          const next = { ...value, stateRevision: revision };
          yield* Ref.set(current, next);
          return next;
        }
        const next = { ...value, stateRevision: ++revision };
        stamp = nextStamp;
        yield* Ref.set(current, next);
        yield* PubSub.publish(hub, next);
        return next;
      }),
    );
    yield* refresh;
    const cached = Ref.get(current).pipe(
      Effect.flatMap((value) => (value ? Effect.succeed(value) : refresh)),
    );
    const run = Effect.forever(Effect.sleep(interval).pipe(Effect.andThen(refresh)));
    const observe = Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(hub);
        const initial = yield* cached;
        let seen = initial.stateRevision ?? 0;
        return Stream.concat(
          Stream.succeed(initial),
          Stream.fromEffectRepeat(PubSub.take(subscription)).pipe(
            Stream.filter((value) => {
              if ((value.stateRevision ?? 0) <= seen) return false;
              seen = value.stateRevision ?? seen;
              return true;
            }),
          ),
        );
      }),
    );
    return { refresh, cached, observe, run };
  });

/** A delayed HTTP response must not replace newer SSE state, including external system changes. */
export const accept = (previous: Snapshot | undefined, value: Snapshot): Snapshot => {
  if (!previous || previous.sessionId !== value.sessionId) return value;
  if (previous.stateRevision !== undefined && value.stateRevision !== undefined)
    return previous.stateRevision > value.stateRevision ? previous : value;
  return previous.inputSequence > value.inputSequence ||
    previous.plugins.revision > value.plugins.revision ||
    (previous.plugins.revision === value.plugins.revision &&
      previous.layout.revision > value.layout.revision)
    ? previous
    : value;
};
