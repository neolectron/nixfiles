import { Context, Effect, Layer, Schema, Stream, type Scope } from 'effect';
import type { Device, StreamDeck } from './stream-deck.ts';

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
  readonly setup: Effect.Effect<Instance<Api, E, R>, E, R | StreamDeck | Scope.Scope>;
}
/** Inference preserves the API and dependencies; setup may provide one or more Layers. */
export const define = <Api, E, R>(definition: Definition<Api, E, R>): Definition<Api, E, R> => definition;

/** Connect any Effect Stream. Ordering and backpressure are retained; failure reaches the host. */
export const listen = <A, E, R, E2, R2>(source: Stream.Stream<A, E, R>, consume: (event: A) => Effect.Effect<unknown, E2, R2>) => Stream.runForEach(source, consume);

/** Build services in the activation scope, keeping Layer finalizers alive until disable. */
export const fromLayer = <S, Api, E, R, E2 = never, R2 = never>(options: Omit<Definition<Api, E | E2, R | R2>, 'setup'> & {
  readonly service: Context.Key<S, Api>;
  readonly layer: Layer.Layer<S, E, R>;
  readonly run?: (api: Api) => Effect.Effect<unknown, E2, R2>;
}) => define<Api, E | E2, R | R2>({ ...options, setup: Effect.gen(function*() {
  const services = yield* Layer.build(options.layer);
  const api = Context.get(services, options.service);
  return { api, ...(options.run ? { run: options.run(api) } : {}) };
}) });

export interface ActionInfo {
  readonly id: string; readonly name: string; readonly description: string;
  readonly schema: unknown; readonly defaults: unknown;
  readonly interaction: 'press' | 'hold';
}
export interface Invocation {
  readonly output: (text: string) => Effect.Effect<void>;
  /** Completes on the original physical key's release, even after navigation. */
  readonly released?: Effect.Effect<void>;
}
/** Strict parameter-free action schema, also represented as an empty browser form. */
export const NoInput = Schema.Record(Schema.String, Schema.Never);
export interface Action<Api> {
  readonly info: ActionInfo;
  readonly validate: (input: unknown) => Effect.Effect<void, unknown>;
  readonly execute: (api: Api, input: unknown, context: Invocation) => Effect.Effect<unknown, unknown, StreamDeck | Scope.Scope>;
}
/** Schema is the single source for decoded input, browser fields and runtime validation. */
export const action = <Api, Input, Encoded, E>(options: {
  readonly id: string; readonly name: string; readonly description: string;
  readonly input: Schema.Codec<Input, Encoded>; readonly defaults: Encoded;
  readonly interaction?: 'press' | 'hold';
  readonly run: (api: Api, input: Input, context: Invocation) => Effect.Effect<unknown, E, StreamDeck | Scope.Scope>;
}): Action<Api> => ({
  info: { id: options.id, name: options.name, description: options.description, schema: Schema.toJsonSchemaDocument(options.input), defaults: options.defaults, interaction: options.interaction ?? 'press' },
  validate: (input) => Schema.decodeUnknownEffect(options.input, { onExcessProperty: 'error' })(input).pipe(Effect.asVoid),
  execute: (api, input, context) => Schema.decodeUnknownEffect(options.input, { onExcessProperty: 'error' })(input).pipe(Effect.flatMap((value) => options.run(api, value, context))),
});
