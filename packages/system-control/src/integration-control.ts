import { Context, Effect, Layer, Option, PubSub, Ref, Schema, Stream } from 'effect';
import { PersistentState } from './persistent-state.ts';
import { IntegrationError } from './errors.ts';

export const ids = [
  'audio',
  'media',
  'desktop',
  'discord',
  'obs',
  'appearance',
  'dot',
  'codex',
  'text',
] as const;
export const make = (key = 'integrations.v1.json') =>
  Effect.gen(function* () {
    const document = (yield* PersistentState).document(
      key,
      Schema.Record(Schema.String, Schema.Boolean),
    );
    const state = yield* Ref.make(
      Option.getOrElse(yield* document.get, () => ({}) as Readonly<Record<string, boolean>>),
    );
    const hub = yield* Effect.acquireRelease(
      PubSub.sliding<Readonly<Record<string, boolean>>>(16),
      PubSub.shutdown,
    );
    const changes = Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(hub);
        return Stream.concat(
          Stream.fromEffect(Ref.get(state)),
          Stream.fromEffectRepeat(PubSub.take(subscription)),
        );
      }),
    );
    const enabled = (id: string) => Effect.map(Ref.get(state), (values) => values[id] ?? true);
    const until = (id: string, expected: boolean) =>
      Stream.runHead(
        changes.pipe(Stream.filter((values) => (values[id] ?? true) === expected)),
      ).pipe(Effect.asVoid);
    return {
      changes,
      enabled,
      until,
      snapshot: Effect.map(Ref.get(state), (values) =>
        ids.map((id) => ({ id, enabled: values[id] ?? true })),
      ),
      set: (id: string, value: boolean) =>
        Effect.gen(function* () {
          if (!(ids as ReadonlyArray<string>).includes(id))
            return yield* new IntegrationError({ message: 'Intégration inconnue.' });
          const next = yield* document.modify((before) =>
            Effect.succeed({ ...Option.getOrElse(before, () => ({})), [id]: value }),
          );
          yield* Ref.set(state, next);
          yield* PubSub.publish(hub, next);
        }).pipe(
          Effect.uninterruptible,
          Effect.mapError(
            () => new IntegrationError({ message: 'Configuration de l’intégration impossible.' }),
          ),
        ),
    };
  });
export type Controller = Effect.Success<ReturnType<typeof make>>;
export class IntegrationControl extends Context.Service<IntegrationControl, Controller>()(
  '@nixfiles/system-control/IntegrationControl',
) {
  static readonly layer = (key?: string) => Layer.effect(IntegrationControl, make(key));
}
