import { Cause, Data, Duration, Effect, Queue, Schedule, Stream } from 'effect';

export class SourceError extends Data.TaggedError('SourceError')<{ readonly message: string; readonly cause?: unknown }> {}
/** For native SDK callbacks/EventEmitters. Unsubscribe is guaranteed when consumption stops. */
export const callback = <A>(subscribe: (emit: (event: A) => boolean) => (() => void), options: { readonly capacity?: number; readonly latest?: boolean } = {}) =>
  Stream.callback<A, SourceError>((queue) => Effect.acquireRelease(
    Effect.try({
      try: () => subscribe((event) => {
        const accepted = Queue.offerUnsafe(queue, event);
        if (!accepted) Queue.failCauseUnsafe(queue, Cause.fail(new SourceError({ message: 'Event source buffer full. Increase capacity or use latest: true for replaceable state.' })));
        return accepted;
      }),
      catch: (cause) => new SourceError({ message: 'Could not subscribe to event source.', cause }),
    }),
    (unsubscribe) => Effect.sync(unsubscribe),
  ), { bufferSize: options.capacity ?? 256, strategy: options.latest ? 'sliding' : 'dropping' });

/** Polling is just another source. Supply retry/recovery on the read Effect if appropriate. */
export const poll = <A, E, R>(read: Effect.Effect<A, E, R>, interval: Duration.Input = 500) => Stream.fromEffectSchedule(read, Schedule.spaced(interval));
