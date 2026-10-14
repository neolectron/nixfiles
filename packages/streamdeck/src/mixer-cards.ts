import { Context, Effect, Exit, Fiber, Layer, Scope } from 'effect';
import type { Application, Change } from './audio.ts';
import type { RgbImage } from './image.ts';
import type { Size } from './model.ts';
import { invalid } from './errors.ts';
export interface Identity {
  readonly key: string;
  readonly name: string;
  readonly aliases?: ReadonlyArray<string>;
}
export interface Frame<E = never, R = never> {
  readonly stamp: string;
  readonly draw: Effect.Effect<RgbImage, E, R>;
}
export interface Contribution<E, R> {
  readonly id: string;
  readonly matches: (app: Application) => boolean;
  /** Keep an application's card present while its audio stream is temporarily absent. */
  readonly retain?: Effect.Effect<ReadonlyArray<Identity>, E, R>;
  readonly frame: (app: Application, size: Size) => Effect.Effect<Frame<E, R> | undefined, E, R>;
  readonly tap?: {
    readonly label: string;
    readonly run: (app: Application) => Effect.Effect<void, E, R>;
  };
  /** Notification of a local knob adjustment; audio writes remain owned by the mixer. */
  readonly onAdjust?: (app: Application, change: Change) => Effect.Effect<void, E, R>;
  /** The compositor offers only contiguous empty slots, never another app or Master. */
  readonly expandIntoEmpty?: boolean;
  /** Keep this source after ordinary app cards, independently of its selected view. */
  readonly placement?: 'last';
}
/** The mixer owns LCD pixels and geometry; scoped contributors own their content and behavior. */
export const make = Effect.sync(() => {
  type Entry = {
    matches: Contribution<never, never>['matches'];
    retain: Effect.Effect<ReadonlyArray<Identity>>;
    frame: (
      app: Application,
      size: Size,
      available?: Size,
    ) => Effect.Effect<
      | {
          stamp: string;
          size: Size;
          draw: Effect.Effect<RgbImage | undefined>;
        }
      | undefined
    >;
    label: string | undefined;
    tap: (app: Application) => Effect.Effect<boolean>;
    adjust: (app: Application, change: Change) => Effect.Effect<boolean>;
    placement: 'last' | undefined;
  };
  const entries = new Map<string, Entry>();
  let revision = 0;
  const register = <E, R>(contribution: Contribution<E, R>) =>
    Effect.gen(function* () {
      if (entries.has(contribution.id))
        return yield* Effect.fail(
          invalid('mixer-card', `Duplicate card contribution: ${contribution.id}.`),
        );
      const owner = yield* Effect.scope;
      const context = yield* Effect.context<R>();
      const generation = ++revision;
      let active = true;
      const available = () => active && owner.state._tag !== 'Closed';
      const invoke = <A>(task: Effect.Effect<A, E, R>) =>
        Effect.gen(function* () {
          if (!available()) return undefined;
          const fiber = yield* Effect.forkIn(
            task.pipe(Effect.provideContext(context), Scope.provide(owner)),
            owner,
          );
          const result = yield* Effect.exit(Fiber.join(fiber));
          if (!available()) return undefined;
          if (Exit.isFailure(result)) return yield* Effect.failCause(result.cause);
          return result.value;
        }).pipe(
          Effect.catch((error) =>
            Effect.logWarning('Mixer card', contribution.id, error).pipe(Effect.as(undefined)),
          ),
        );
      const entry: Entry = {
        matches: contribution.matches,
        placement: contribution.placement,
        retain: contribution.retain
          ? invoke(contribution.retain).pipe(Effect.map((value) => value ?? []))
          : Effect.succeed([]),
        frame: (app, size, currentAvailable) =>
          Effect.gen(function* () {
            const actual =
              contribution.expandIntoEmpty && currentAvailable ? currentAvailable : size;
            const frame = yield* invoke(contribution.frame(app, actual));
            return frame
              ? {
                  stamp: `${contribution.id}/${generation}/${frame.stamp}`,
                  size: actual,
                  draw: invoke(frame.draw),
                }
              : undefined;
          }),
        label: contribution.tap?.label,
        tap: (app) =>
          contribution.tap
            ? invoke(contribution.tap.run(app).pipe(Effect.as(true))).pipe(
                Effect.map((value) => value ?? false),
              )
            : Effect.succeed(false),
        adjust: (app, change) =>
          contribution.onAdjust
            ? invoke(contribution.onAdjust(app, change).pipe(Effect.as(true))).pipe(
                Effect.map((value) => value ?? false),
              )
            : Effect.succeed(false),
      };
      entries.set(contribution.id, entry);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          active = false;
          if (entries.get(contribution.id) === entry) entries.delete(contribution.id);
        }),
      );
    });
  const find = (app: Application) => [...entries.values()].find((entry) => entry.matches(app));
  return {
    register,
    frame: (app: Application, size: Size, available?: Size) =>
      Effect.suspend(() => find(app)?.frame(app, size, available) ?? Effect.succeed(undefined)),
    tap: (app: Application) => Effect.suspend(() => find(app)?.tap(app) ?? Effect.succeed(false)),
    adjust: (app: Application, change: Change) =>
      Effect.suspend(() => find(app)?.adjust(app, change) ?? Effect.succeed(false)),
    label: (app: Application) => Effect.sync(() => find(app)?.label),
    placement: (app: Application) => Effect.sync(() => find(app)?.placement),
    retain: Effect.suspend(() =>
      Effect.forEach([...entries.values()], (entry) => entry.retain).pipe(
        Effect.map((groups) => groups.flat()),
      ),
    ),
  };
});
export class MixerCards extends Context.Service<MixerCards, Effect.Success<typeof make>>()(
  '@nixfiles/streamdeck/MixerCards',
) {
  static readonly layer = Layer.effect(MixerCards, make);
}
