import { Context, Crypto, Effect, Layer, Result, Semaphore } from 'effect';
import { Base64 } from 'effect/encoding';

const maxBytes = 1024 * 1024;
/** Small scoped cache for immutable artwork; snapshots contain URLs, never base64 bodies. */
export const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const lock = yield* Semaphore.make(1);
  const entries = new Map<string, { id: string; bytes: Uint8Array; contentType: string }>();
  let closed = false;
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true;
      entries.clear();
    }),
  );
  return {
    publish: (data: string | undefined) =>
      Semaphore.withPermits(
        lock,
        1,
      )(
        Effect.gen(function* () {
          if (closed || !data || data.length > maxBytes * 1.4) return undefined;
          const found = entries.get(data);
          if (found) {
            entries.delete(data);
            entries.set(data, found);
            return `/api/assets/${found.id}`;
          }
          const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(data);
          if (!match?.[1] || !match[2]) return undefined;
          const decoded = Base64.decode(match[2]);
          if (
            Result.isFailure(decoded) ||
            !decoded.success.length ||
            decoded.success.length > maxBytes
          )
            return undefined;
          const id = yield* crypto.randomUUIDv4();
          if (closed) return undefined;
          const oldest = entries.keys().next().value;
          if (entries.size >= 8 && oldest !== undefined) entries.delete(oldest);
          entries.set(data, { id, bytes: decoded.success, contentType: match[1] });
          return `/api/assets/${id}`;
        }),
      ).pipe(Effect.orElseSucceed(() => undefined)),
    get: (id: string) =>
      Effect.sync(() =>
        closed ? undefined : [...entries.values()].find((entry) => entry.id === id),
      ),
  };
});
export class PresentationAssets extends Context.Service<
  PresentationAssets,
  Effect.Success<typeof make>
>()('@nixfiles/streamdeck/PresentationAssets') {
  static readonly layer = Layer.effect(PresentationAssets, make);
}
