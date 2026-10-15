import { Context, Effect, Equal, Exit, Fiber, Layer, Scope, Semaphore } from 'effect';
import type { Size, DeckEvent } from './model.ts';
import type { Region } from './presentation.tsx';
import type { Frame } from './mixer-cards.ts';
import * as Keys from './deck-overlays.ts';
import { invalid, type StreamDeckError } from './errors.ts';

export interface Touch {
  readonly lcd: number;
  readonly kind: 'tap' | 'hold' | 'swipe';
  readonly x: number;
  readonly y: number;
  readonly toX?: number;
}
export interface LcdClaim<E = never, R = never> {
  readonly lcd: number;
  readonly region: Omit<Region, 'view'>;
  readonly frame: Frame<E, R> & { readonly view: Region['view'] };
  readonly onTouch?: (input: Touch) => Effect.Effect<unknown, E, R>;
}
export type KnobInput = Extract<DeckEvent, { dial: number }>;
export interface KnobClaim<E = never, R = never> {
  readonly dial: number;
  readonly onInput: (input: KnobInput) => Effect.Effect<unknown, E, R>;
}
export interface Scene<E = never, R = never> {
  readonly name: string;
  readonly priority?: number;
  readonly keys?: Keys.KeyOverlay;
  readonly lcd?: ReadonlyArray<LcdClaim<E, R>>;
  readonly knobs?: ReadonlyArray<KnobClaim<E, R>>;
}
export const make = (
  keys: ReadonlyArray<number>,
  lcds: ReadonlyArray<Size & { index: number }>,
  dials: ReadonlyArray<number> = [],
) =>
  Effect.gen(function* () {
    const keyHost = yield* Keys.make(keys);
    type Claim = LcdClaim<StreamDeckError, never>;
    type Entry = {
      token: number;
      order: number;
      owner: string;
      id: string;
      name: string;
      priority: number;
      lcd: ReadonlyArray<Claim>;
      knobs: ReadonlyArray<KnobClaim<StreamDeckError>>;
    };
    const entries = new Map<number, Entry>();
    let sequence = 0;
    let revision = 0;
    const forOwner = (owner: string, active: () => boolean = () => true) => ({
      open: <E = unknown, R = never>(id: string, initial?: Scene<E, R>) =>
        Effect.gen(function* () {
          const token = ++sequence;
          const context = yield* Effect.context<R>();
          let scope = yield* Scope.make();
          const commandsScope = yield* Scope.make();
          const mutations = yield* Semaphore.make(1);
          const keyPresentation = yield* keyHost.forOwner(owner, active).open(id);
          let closed = false;
          let previous: Scene<E, R> | null = null;
          const update = (scene: Scene<E, R> | null) =>
            Effect.gen(function* () {
              if (closed || !active())
                return yield* invalid('surface-host', 'Présentation fermée.');
              if (Equal.equals(previous, scene)) return;
              for (const claim of scene?.lcd ?? []) {
                const size = lcds.find((lcd) => lcd.index === claim.lcd);
                const r = claim.region;
                if (
                  !size ||
                  ![r.x, r.y, r.width, r.height].every(Number.isSafeInteger) ||
                  r.x < 0 ||
                  r.y < 0 ||
                  r.width <= 0 ||
                  r.height <= 0 ||
                  r.x + r.width > size.width ||
                  r.y + r.height > size.height
                )
                  return yield* invalid('surface-host', 'Région LCD invalide.');
              }
              if (
                (scene?.knobs ?? []).some((claim) => !dials.includes(claim.dial)) ||
                new Set(scene?.knobs?.map((claim) => claim.dial)).size !==
                  (scene?.knobs?.length ?? 0)
              )
                return yield* invalid('surface-host', 'Potard invalide ou déclaré plusieurs fois.');
              yield* keyPresentation.update(
                scene?.keys
                  ? { ...scene.keys, priority: scene.priority ?? scene.keys.priority ?? 0 }
                  : null,
              );
              const retired = scope;
              scope = yield* Scope.make();
              yield* Scope.close(retired, Exit.void);
              if (!scene) entries.delete(token);
              else {
                const renderScope = scope;
                const guarded = <A>(
                  effect: Effect.Effect<A, E, R>,
                  rendering = true,
                ): Effect.Effect<A, StreamDeckError> =>
                  Effect.suspend(() =>
                    !closed && active() && renderScope === scope
                      ? Effect.acquireUseRelease(
                          Effect.forkIn(
                            Effect.scoped(effect).pipe(Effect.provideContext(context)),
                            rendering ? renderScope : commandsScope,
                          ),
                          Fiber.join,
                          Fiber.interrupt,
                        ).pipe(
                          Effect.mapError((error) =>
                            invalid(
                              'surface-host',
                              error instanceof Error ? error.message : 'Présentation indisponible.',
                            ),
                          ),
                          Effect.catchCause((cause) =>
                            closed || renderScope !== scope
                              ? Effect.fail(invalid('surface-host', 'Présentation fermée.'))
                              : Effect.failCause(cause),
                          ),
                        )
                      : Effect.fail(invalid('surface-host', 'Présentation fermée.')),
                  );
                entries.set(token, {
                  token,
                  order: ++sequence,
                  owner,
                  id,
                  name: scene.name,
                  priority: scene.priority ?? 0,
                  knobs: (scene.knobs ?? []).map((claim) => ({
                    dial: claim.dial,
                    onInput: (input) => guarded(claim.onInput(input), false),
                  })),
                  lcd: (scene.lcd ?? []).map((claim) => {
                    const onTouch = claim.onTouch;
                    const next: Claim = {
                      lcd: claim.lcd,
                      region: claim.region,
                      frame: {
                        stamp: claim.frame.stamp,
                        view: claim.frame.view,
                        draw: guarded(claim.frame.draw),
                      },
                    };
                    return onTouch
                      ? Object.assign(next, {
                          onTouch: (input: Touch) => guarded(onTouch(input), false),
                        })
                      : next;
                  }),
                });
              }
              previous = scene;
              revision++;
            }).pipe(Effect.uninterruptible, Semaphore.withPermits(mutations, 1));
          const close = Effect.gen(function* () {
            if (closed) return;
            closed = true;
            entries.delete(token);
            yield* Scope.close(scope, Exit.void);
            yield* Scope.close(commandsScope, Exit.void);
            yield* keyPresentation.close;
            revision++;
          }).pipe(Effect.uninterruptible, Semaphore.withPermits(mutations, 1));
          yield* Effect.addFinalizer(() => close);
          if (initial) yield* update(initial);
          return { update, close };
        }),
    });
    const ordered = () =>
      [...entries.values()].toSorted((a, b) => a.priority - b.priority || a.order - b.order);
    return {
      ...forOwner('script'),
      keys: keyHost,
      forOwner,
      snapshot: Effect.sync(() => ({ revision, entries: ordered() })),
      touch: (input: Touch) =>
        Effect.gen(function* () {
          const claim = ordered()
            .toReversed()
            .flatMap((entry) => entry.lcd.toReversed())
            .find(
              (c) =>
                c.lcd === input.lcd &&
                input.x >= c.region.x &&
                input.x < c.region.x + c.region.width &&
                input.y >= c.region.y &&
                input.y < c.region.y + c.region.height,
            );
          if (!claim) return false;
          if (claim.onTouch) yield* claim.onTouch(input);
          return true;
        }),
      knobCovered: (dial: number) =>
        Effect.sync(() =>
          ordered().some((entry) => entry.knobs.some((claim) => claim.dial === dial)),
        ),
      knob: (input: KnobInput) =>
        Effect.gen(function* () {
          const claim = ordered()
            .toReversed()
            .flatMap((entry) => entry.knobs)
            .find((c) => c.dial === input.dial);
          if (!claim) return false;
          yield* claim.onInput(input);
          return true;
        }),
      covered: (lcd: number, x: number, y: number) =>
        Effect.sync(() =>
          ordered().some((entry) =>
            entry.lcd.some(
              (claim) =>
                claim.lcd === lcd &&
                x >= claim.region.x &&
                x < claim.region.x + claim.region.width &&
                y >= claim.region.y &&
                y < claim.region.y + claim.region.height,
            ),
          ),
        ),
    };
  });
export type Controller = Effect.Success<ReturnType<typeof make>>;
export class SurfaceHost extends Context.Service<SurfaceHost, Controller>()(
  '@nixfiles/streamdeck/SurfaceHost',
) {}
export const layer = (
  keys: ReadonlyArray<number>,
  lcds: ReadonlyArray<Size & { index: number }>,
  dials: ReadonlyArray<number> = [],
) => Layer.effect(SurfaceHost, make(keys, lcds, dials));
