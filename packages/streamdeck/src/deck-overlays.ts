import { Context, Data, Effect, Equal, Layer, Schema } from 'effect';
import { ButtonBinding, type Entry } from './studio-contract.ts';

export const KeyOverlay = Schema.Struct({
  name: Schema.NonEmptyString,
  priority: Schema.optionalKey(Schema.Int),
  /** Missing keys pass through; null explicitly masks the key underneath. */
  keys: Schema.Record(Schema.String, Schema.NullOr(ButtonBinding)),
});
export type KeyOverlay = typeof KeyOverlay.Type;
export class OverlayError extends Data.TaggedError('OverlayError')<{
  readonly owner: string;
  readonly reason: 'Invalid' | 'Conflict' | 'Closed';
  readonly message: string;
}> {}
export interface Presentation {
  readonly update: (overlay: KeyOverlay | null) => Effect.Effect<void, OverlayError>;
  /** Idempotent, and only removes this presentation. */
  readonly close: Effect.Effect<void>;
}
export interface Controller {
  /** The caller's Scope owns the presentation, including failure/interruption cleanup. */
  readonly open: (
    id: string,
    initial?: KeyOverlay | null,
  ) => Effect.Effect<Presentation, OverlayError, import('effect').Scope.Scope>;
}
export interface Claim {
  readonly owner: string;
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly entry: Entry | null;
}
/** One arbiter for key rendering AND routing. No plugin writes physical key images here. */
export const make = (keys: ReadonlyArray<number>) =>
  Effect.gen(function* () {
    let closed = false;
    let revision = 0;
    let sequence = 0;
    type Record = {
      owner: string;
      id: string;
      token: number;
      order: number;
      generation: number;
      value: KeyOverlay | null;
    };
    const records = new Map<string, Record>();
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true;
        records.clear();
        revision++;
      }),
    );
    const forOwner = (owner: string, active: () => boolean = () => true): Controller => ({
      open: (id, initial = null) =>
        Effect.gen(function* () {
          const fail = (reason: OverlayError['reason'], message: string) =>
            new OverlayError({ owner, reason, message });
          const key = JSON.stringify([owner, id]);
          let record: Record | undefined;
          let released = false;
          const update = (input: KeyOverlay | null) =>
            Effect.gen(function* () {
              const value =
                input === null
                  ? null
                  : yield* Schema.decodeUnknownEffect(KeyOverlay, { onExcessProperty: 'error' })(
                      input,
                    ).pipe(Effect.mapError(() => fail('Invalid', 'Overlay invalide.')));
              if (
                value &&
                Object.keys(value.keys).some(
                  (index) => String(Number(index)) !== index || !keys.includes(Number(index)),
                )
              )
                return yield* fail(
                  'Invalid',
                  'Une touche de cet overlay n’existe pas sur le deck.',
                );
              yield* Effect.suspend(() => {
                if (closed || released || !active())
                  return Effect.fail(fail('Closed', 'Cette présentation est fermée.'));
                if (!record)
                  return Effect.fail(fail('Closed', 'Cette présentation n’est pas ouverte.'));
                if (Equal.equals(record.value, value)) return Effect.void;
                if (!record.value && value) record.order = ++sequence;
                record.value = value === null ? null : structuredClone(value);
                record.generation++;
                revision++;
                return Effect.void;
              });
            });
          const close = Effect.sync(() => {
            if (released) return;
            released = true;
            if (records.get(key) !== record) return;
            records.delete(key);
            if (record?.value) revision++;
          });
          return yield* Effect.acquireRelease(
            Effect.gen(function* () {
              if (closed || !active())
                return yield* fail('Closed', 'Le service de présentation est fermé.');
              if (!id.trim())
                return yield* fail('Invalid', 'Un identifiant de présentation est requis.');
              if (records.has(key))
                return yield* fail('Conflict', 'Cette présentation est déjà ouverte.');
              record = { owner, id, token: ++sequence, order: 0, generation: 0, value: null };
              records.set(key, record);
              yield* update(initial).pipe(Effect.onError(() => close));
              return { update, close };
            }),
            () => close,
          );
        }),
    });
    return {
      forOwner,
      snapshot: Effect.sync(() => {
        const winners = new Map<number, Claim>();
        const active = [...records.values()]
          .filter((record) => record.value !== null)
          .toSorted(
            (a, b) => (a.value?.priority ?? 0) - (b.value?.priority ?? 0) || a.order - b.order,
          );
        for (const record of active) {
          if (!record.value) continue;
          for (const [key, binding] of Object.entries(record.value.keys))
            winners.set(Number(key), {
              owner: record.owner,
              id: record.id,
              name: record.value.name,
              address: JSON.stringify([
                'overlay',
                record.owner,
                record.id,
                record.token,
                record.generation,
                key,
              ]),
              entry:
                binding === null
                  ? null
                  : {
                      id: JSON.stringify(['overlay', record.owner, record.id, record.token, key]),
                      binding,
                    },
            });
        }
        return { revision, keys: winners };
      }),
    };
  });
export class DeckOverlays extends Context.Service<DeckOverlays, Controller>()(
  '@nixfiles/streamdeck/DeckOverlays',
) {
  static readonly layer = (keys: ReadonlyArray<number>) =>
    Layer.effect(
      DeckOverlays,
      Effect.map(make(keys), (registry) => registry.forOwner('script')),
    );
}
