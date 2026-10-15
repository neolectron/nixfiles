import {
  Effect,
  Fiber,
  Option,
  PubSub,
  Ref,
  Result,
  Semaphore,
  Stream,
  type Duration,
} from 'effect';
import { IntegrationControl } from './integration-control.ts';

/** A scoped snapshot plus a broadcast stream. Subscribe before reading the initial value. */
export const make = <A, E>(initial: E, integration?: string) =>
  Effect.gen(function* () {
    const control = yield* Effect.serviceOption(IntegrationControl);
    const enabled =
      integration && Option.isSome(control)
        ? control.value.enabled(integration)
        : Effect.succeed(true);
    const owner = yield* Effect.scope;
    const current = yield* Ref.make<Result.Result<A, E>>(Result.fail(initial));
    const events = yield* Effect.acquireRelease(
      PubSub.sliding<Result.Result<A, E>>(64),
      PubSub.shutdown,
    );
    let closed = false;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true;
      }).pipe(Effect.andThen(Ref.set(current, Result.fail(initial)))),
    );
    // An operation belongs both to its caller and to the service's lifetime.
    const guard = <B>(operationInput: Effect.Effect<B, E>) =>
      Effect.gen(function* () {
        if (closed || !(yield* enabled)) return yield* Effect.fail(initial);
        const operation =
          integration && Option.isSome(control)
            ? Effect.raceFirst(
                operationInput,
                control.value.until(integration, false).pipe(Effect.andThen(Effect.fail(initial))),
              )
            : operationInput;
        return yield* Effect.acquireUseRelease(
          Effect.forkIn(operation, owner),
          Fiber.join,
          Fiber.interrupt,
        );
      });
    const publish = (value: Result.Result<A, E>) =>
      Effect.suspend(() =>
        closed
          ? Effect.void
          : Ref.set(current, value).pipe(
              Effect.andThen(PubSub.publish(events, value)),
              Effect.asVoid,
            ),
      );
    const observe = Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(events);
        const snapshot = Effect.flatMap(enabled, (active) =>
          active ? Ref.get(current) : Effect.succeed(Result.fail(initial)),
        );
        const first = yield* snapshot;
        const updates = Stream.fromEffectRepeat(PubSub.take(subscription)).pipe(
          Stream.mapEffect((value) =>
            Effect.map(enabled, (active) => (active ? value : Result.fail(initial))),
          ),
        );
        const changes =
          integration && Option.isSome(control)
            ? control.value.changes.pipe(Stream.mapEffect(() => snapshot))
            : Stream.empty;
        return Stream.concat(Stream.succeed(first), Stream.merge(updates, changes));
      }),
    );
    return {
      snapshot: Effect.flatMap(enabled, (active) =>
        active ? Ref.get(current) : Effect.succeed(Result.fail(initial)),
      ),
      state: guard(Effect.flatMap(Ref.get(current), Effect.fromResult)),
      observe,
      publish,
      guard,
      session: <B, E2, R>(operation: Effect.Effect<B, E2, R>) =>
        integration && Option.isSome(control)
          ? Effect.andThen(
              control.value.until(integration, true),
              Effect.raceFirst(
                operation,
                control.value
                  .until(integration, false)
                  .pipe(Effect.andThen(publish(Result.fail(initial)))),
              ),
            )
          : operation,
    };
  });

/** The Layer's scope owns the sole polling fiber, including its final interruption. */
export const polling = <A, E>(
  read: Effect.Effect<A, E>,
  interval: Duration.Input,
  initial: E,
  integration?: string,
) =>
  Effect.gen(function* () {
    const store = yield* make<A, E>(initial, integration);
    const reads = yield* Semaphore.make(1);
    const refresh = store.guard(
      Semaphore.withPermits(
        reads,
        1,
      )(
        Effect.gen(function* () {
          const result = yield* Effect.result(read);
          yield* store.publish(result);
          return yield* Effect.fromResult(result);
        }),
      ),
    );
    yield* refresh.pipe(Effect.ignore);
    yield* Effect.forkScoped(
      Effect.forever(Effect.sleep(interval).pipe(Effect.andThen(refresh), Effect.ignore)),
    );
    return { ...store, refresh };
  });
