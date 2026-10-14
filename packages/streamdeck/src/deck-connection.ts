import { Context, Data, Deferred, Effect, Layer, PubSub, Semaphore, Stream } from 'effect';
import { Driver, type Connection } from './driver.ts';
import { StreamDeckError, invalid } from './errors.ts';
import { plusXl } from './mock.ts';
import type { DeckEvent, DeviceInfo } from './model.ts';
import type { OpenOptions } from './stream-deck.ts';

export class DeckOffline extends Data.TaggedError('DeckOffline')<{
  readonly message: string;
  readonly cause?: StreamDeckError;
}> {}

/** Owns USB acquisition, failure, scoped release and reconnection; no UI or image caching. */
export const make = (options: OpenOptions = {}) =>
  Effect.gen(function* () {
    const capacity = options.eventCapacity ?? 256;
    if (!Number.isSafeInteger(capacity) || capacity <= 0 || capacity > 65536)
      return yield* invalid('connect', 'eventCapacity must be an integer in 1..65536.');
    const driver = yield* Driver;
    const devices = yield* driver.list.pipe(Effect.catch(() => Effect.succeed([])));
    if (!options.path && devices.length > 1)
      return yield* new StreamDeckError({
        reason: 'Ambiguous',
        operation: 'studio',
        message: 'Multiple Stream Decks found. Select --path explicitly.',
      });
    const initial = options.path
      ? devices.find((device) => device.path === options.path)
      : devices[0];
    // Default to this Studio's established + XL profile, rather than inventing capabilities from absent USB.
    const info: DeviceInfo = initial ?? {
      ...plusXl,
      model: 'Stream Deck + XL',
      path: options.path ?? 'studio://plus-xl',
    };
    let detectedModel: string | null = initial?.model ?? null;
    const lock = yield* Semaphore.make(1);
    const events = yield* Effect.acquireRelease(
      PubSub.bounded<DeckEvent>(capacity),
      PubSub.shutdown,
    );
    const changes = yield* Effect.acquireRelease(PubSub.sliding<boolean>(16), PubSub.shutdown);
    const restorers = new Set<(connection: Connection) => Effect.Effect<void, StreamDeckError>>();
    let connection: Connection | undefined;
    let offline: DeckOffline | null = new DeckOffline({ message: 'Stream Deck déconnecté.' });
    let disconnect: ((error: StreamDeckError) => void) | undefined;
    const use = <A>(operation: (current: Connection) => Effect.Effect<A, StreamDeckError>) =>
      Semaphore.withPermits(
        lock,
        1,
      )(
        Effect.gen(function* () {
          if (!connection || offline)
            return yield* offline ?? new DeckOffline({ message: 'Stream Deck déconnecté.' });
          return yield* operation(connection).pipe(
            Effect.uninterruptible,
            Effect.catch((cause) => {
              disconnect?.(cause);
              return Effect.fail(
                new DeckOffline({
                  message: 'La connexion au Stream Deck a été interrompue.',
                  cause,
                }),
              );
            }),
          );
        }),
      );
    const attempt = Effect.scoped(
      Effect.gen(function* () {
        const available = yield* driver.list;
        const candidates = available.filter(
          (device) => device.productId === info.productId && device.vendorId === info.vendorId,
        );
        const candidate =
          candidates.find((device) => device.path === info.path) ??
          (candidates.length === 1 ? candidates[0] : undefined);
        if (!candidate) return;
        const failed = yield* Deferred.make<never, StreamDeckError>();
        disconnect = (cause) => {
          PubSub.publishUnsafe(changes, false);
          offline = new DeckOffline({
            message: 'La connexion au Stream Deck a été interrompue.',
            cause,
          });
          Deferred.doneUnsafe(failed, Effect.fail(cause));
        };
        const opened = yield* driver.open(candidate, {
          error: (cause) => disconnect?.(cause),
          event: (event) => {
            if (offline) return;
            if (!PubSub.publishUnsafe(events, event))
              disconnect?.(
                new StreamDeckError({
                  reason: 'Overflow',
                  operation: 'connection events',
                  message: 'Stream Deck input buffer full.',
                }),
              );
          },
        });
        yield* Effect.addFinalizer(() =>
          Semaphore.withPermits(
            lock,
            1,
          )(
            Effect.sync(() => {
              connection = undefined;
              offline ??= new DeckOffline({ message: 'Stream Deck déconnecté.' });
              disconnect = undefined;
            }),
          ),
        );
        yield* Semaphore.withPermits(
          lock,
          1,
        )(
          Effect.gen(function* () {
            for (const restore of restorers) yield* restore(opened);
            if (yield* Deferred.isDone(failed)) return;
            connection = opened;
            detectedModel = opened.info.model;
            offline = null;
            yield* PubSub.publish(changes, true);
          }),
        );
        yield* Deferred.await(failed);
      }),
    ).pipe(
      Effect.catch((cause) =>
        Effect.sync(() => {
          offline = new DeckOffline({ message: 'Connexion USB indisponible.', cause });
        }),
      ),
      Effect.catchCause((cause) => Effect.logDebug('Stream Deck connection unavailable', cause)),
    );
    yield* Effect.forkScoped(Effect.forever(attempt.pipe(Effect.andThen(Effect.sleep(1000)))));
    return {
      info,
      detectedModel: Effect.sync(() => detectedModel),
      connected: Effect.sync(() => offline === null),
      changes: Stream.fromPubSub(changes),
      error: Effect.sync(() => offline),
      subscribe: Effect.map(PubSub.subscribe(events), (subscription) =>
        Stream.fromEffectRepeat(PubSub.take(subscription)).pipe(
          Stream.filter(() => offline === null),
        ),
      ),
      use,
      /** Restore output before accepting inputs after reconnecting. Registration belongs to the caller's scope. */
      onConnect: (restore: (current: Connection) => Effect.Effect<void, StreamDeckError>) =>
        Effect.acquireRelease(
          Semaphore.withPermits(
            lock,
            1,
          )(
            Effect.gen(function* () {
              if (connection && !offline) yield* restore(connection);
              restorers.add(restore);
              return restore;
            }),
          ),
          (current) =>
            Semaphore.withPermits(
              lock,
              1,
            )(
              Effect.sync(() => {
                restorers.delete(current);
              }),
            ),
        ).pipe(Effect.asVoid),
    };
  });
export class DeckConnection extends Context.Service<
  DeckConnection,
  Effect.Success<ReturnType<typeof make>>
>()('@nixfiles/streamdeck/DeckConnection') {
  static readonly layer = (options: OpenOptions = {}) =>
    Layer.effect(DeckConnection, make(options));
}
