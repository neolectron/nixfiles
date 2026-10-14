import { Context, Effect, Layer, Schema, Stream, type Scope } from 'effect';
import type { Device, StreamDeck } from './stream-deck.ts';
import type { KeyFeedback } from './key-feedback.ts';
import * as Bindings from './bindings.ts';
import type { PressContext } from './press-gestures.ts';
import { defaults } from './press-trigger.ts';
import { invalid, invariant } from './errors.ts';
import { DeckOverlays, type KeyOverlay } from './deck-overlays.ts';
export interface Controls {
  readonly keys?: ReadonlyArray<number>;
  readonly dials?: ReadonlyArray<number>;
  readonly lcds?: ReadonlyArray<number>;
}
export interface Instance<Api, E = never, R = never> {
  readonly api: Api;
  /** A finite source may finish; the plugin remains enabled until explicitly stopped. */
  readonly run?: Effect.Effect<unknown, E, R>;
}
export interface Definition<Api, E, R> {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly controls: Controls | ((deck: Device) => Controls);
  readonly actions?: ReadonlyArray<Action<Api>>;
  readonly supported?: (deck: Device) => boolean;
  readonly setup: Effect.Effect<
    Instance<Api, E, R>,
    E,
    R | StreamDeck | DeckOverlays | Scope.Scope
  >;
}
/** Inference preserves the API and dependencies; setup may provide one or more Layers. */
export const define = <Api, E = never, R = never, SetupE = never, SetupR = never>(
  definition: Omit<Definition<Api, E, R>, 'setup'> & {
    readonly setup: Effect.Effect<
      Instance<Api, E, R>,
      SetupE,
      SetupR | StreamDeck | DeckOverlays | Scope.Scope
    >;
  },
): Definition<Api, E | SetupE, R | SetupR> => definition;
/** Connect any Stream to an Effect callback or the same declared-action handlers as controls. */
export const listen = <A, E, R, E2, R2>(
  source: Stream.Stream<A, E, R>,
  consume: Bindings.Handler<A, E2, R2>,
) => Bindings.listen(source, consume);
/** Select a temporary key layout from any event source, in the plugin activation scope.
 * Returning null restores the underlying layout. Repeated equal selections do not
 * repaint, reorder or invalidate gestures. Source failure releases the presentation.
 */
export const presentFrom = <A, E, R, E2, R2>(
  id: string,
  source: Stream.Stream<A, E, R>,
  select: (event: A) => Effect.Effect<KeyOverlay | null, E2, R2>,
) =>
  Effect.gen(function* () {
    const overlays = yield* DeckOverlays;
    const presentation = yield* overlays.open(id);
    return listen(source, (event: A) => Effect.flatMap(select(event), presentation.update));
  });
/** Build services in the activation scope, keeping Layer finalizers alive until disable. */
export const fromLayer = <S, Api, E, R, E2 = never, R2 = never>(
  options: Omit<Definition<Api, E | E2, R | R2>, 'setup'> & {
    readonly service: Context.Key<S, Api>;
    readonly layer: Layer.Layer<S, E, R>;
    readonly run?: (api: Api) => Effect.Effect<unknown, E2, R2>;
  },
) =>
  define<Api, E2, R2, E, R>({
    ...options,
    setup: Effect.gen(function* () {
      const services = yield* Layer.build(options.layer);
      const api = Context.get(services, options.service);
      return { api, ...(options.run ? { run: options.run(api) } : {}) };
    }),
  });
export interface ActionInfo {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly schema: unknown;
  readonly defaults: unknown;
  readonly interaction: 'press' | 'hold';
  /** A ready-to-assign tile, using this action's schema/defaults and live feedback. */
  readonly tile?: Tile;
}
export interface Tile {
  readonly label: string;
  readonly icon: KeyFeedback['icon'];
}
export interface Invocation {
  readonly output: (text: string) => Effect.Effect<void>;
  /** Completes on the original physical key's release, even after navigation. */
  readonly released?: Effect.Effect<void>;
  /** Completes only for an abandoned press (pointer cancellation, lost focus). */
  readonly cancelled?: Effect.Effect<void>;
  readonly gesture?: PressContext['gesture'];
}
/** Shared tap/hold arbitration. A preclassified long press does not wait twice. */
export const tapOrHold = <A, E, R, B, E2, R2>(
  context: Invocation,
  tap: Effect.Effect<A, E, R>,
  hold: (released: Effect.Effect<void>) => Effect.Effect<B, E2, R2>,
  milliseconds: number = defaults.longPressMs,
): Effect.Effect<A | B, E | E2, R | R2> => {
  const released = context.released;
  if (!released) return tap;
  const run =
    context.gesture === 'long-press'
      ? hold(released)
      : Effect.raceFirst(
          released.pipe(Effect.as(false)),
          Effect.sleep(milliseconds).pipe(Effect.as(true)),
        ).pipe(
          Effect.flatMap(
            (long): Effect.Effect<A | B, E | E2, R | R2> => (long ? hold(released) : tap),
          ),
        );
  return context.cancelled
    ? Effect.raceFirst(run, context.cancelled.pipe(Effect.andThen(Effect.interrupt)))
    : run;
};
/** Strict parameter-free action schema, also represented as an empty browser form. */
export const NoInput = Schema.Record(Schema.String, Schema.Never);
export interface Action<Api, Input = unknown, E = unknown, R = StreamDeck | Scope.Scope> {
  readonly info: ActionInfo & {
    readonly defaults: Input;
  };
  readonly validate: (input: unknown) => Effect.Effect<void, unknown>;
  readonly execute: (
    api: Api,
    input: unknown,
    context: Invocation,
  ) => Effect.Effect<unknown, E | Schema.SchemaError, R>;
  readonly feedback?: (
    api: Api,
    input: unknown,
  ) => Effect.Effect<KeyFeedback, E | Schema.SchemaError, R>;
  readonly unavailable?: KeyFeedback;
}
/** Reuse a declared action on any control/gesture, without studio or timer code.
 * Execution is supervised by Bindings and canceled with the binding/plugin scope.
 */
const isPress = (event: unknown): event is PressContext =>
  typeof event === 'object' &&
  event !== null &&
  'released' in event &&
  Effect.isEffect(event.released) &&
  'gesture' in event &&
  (event.gesture === 'press' ||
    event.gesture === 'short-press' ||
    event.gesture === 'long-press' ||
    event.gesture === 'double-tap');
export const mapHandler = <Api, Input, E, R, Event>(
  action: Action<Api, Input, E, R>,
  api: Api,
  input: (event: Event) => NoInfer<Input>,
  output: Invocation['output'] = (text) => Effect.logInfo(text),
) =>
  Bindings.background((event: Event) =>
    Effect.scoped(
      Effect.gen(function* () {
        const press = isPress(event) ? event : undefined;
        if (
          action.info.interaction === 'hold' &&
          (!press || press.gesture === 'short-press' || press.gesture === 'double-tap')
        )
          return yield* Effect.fail(
            invalid('plugin', 'A hold action requires onPress or onLongPress on a key or dial.'),
          );
        return yield* action.execute(api, input(event), {
          output,
          ...(press
            ? { released: press.released, cancelled: press.cancelled, gesture: press.gesture }
            : {}),
        });
      }),
    ),
  );
export const handler = <Api, Input, E, R>(
  action: Action<Api, Input, E, R>,
  api: Api,
  input: NoInfer<Input> = action.info.defaults,
  output?: Invocation['output'],
) => mapHandler<Api, Input, E, R, unknown>(action, api, () => input, output);
/** Schema is the single source for decoded input, browser fields and runtime validation. */
export const action = <Api, Input, Encoded, E, R>(options: {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly input: Schema.Codec<Input, Encoded>;
  readonly defaults: Encoded;
  readonly interaction?: 'press' | 'hold';
  readonly tile?: Tile;
  readonly feedback?: (api: Api, input: Input) => Effect.Effect<KeyFeedback, E, R>;
  readonly unavailable?: KeyFeedback;
  readonly run: (api: Api, input: Input, context: Invocation) => Effect.Effect<unknown, E, R>;
}): Action<Api, Encoded, E, R> => ({
  info: {
    id: options.id,
    name: options.name,
    description: options.description,
    schema: Schema.toJsonSchemaDocument(options.input),
    defaults: options.defaults,
    interaction: options.interaction ?? 'press',
    ...(options.tile ? { tile: options.tile } : {}),
  },
  validate: (input) =>
    Schema.decodeUnknownEffect(options.input, { onExcessProperty: 'error' })(input).pipe(
      Effect.asVoid,
    ),
  execute: (api, input, context) =>
    Schema.decodeUnknownEffect(options.input, { onExcessProperty: 'error' })(input).pipe(
      Effect.flatMap((value) => options.run(api, value, context)),
    ),
  ...(options.feedback || options.tile
    ? {
        feedback: (api: Api, input: unknown) =>
          Schema.decodeUnknownEffect(options.input, { onExcessProperty: 'error' })(input).pipe(
            Effect.flatMap((value) =>
              options.feedback
                ? options.feedback(api, value)
                : Effect.succeed({
                    icon: invariant(options.tile, 'plugin').icon,
                    text: 'PRÊT',
                    tone: 'neutral' as const,
                  }),
            ),
          ),
      }
    : {}),
  ...(options.unavailable
    ? { unavailable: options.unavailable }
    : options.tile
      ? {
          unavailable: { icon: options.tile.icon, text: 'DÉSACTIVÉ', tone: 'neutral' as const },
        }
      : {}),
});
