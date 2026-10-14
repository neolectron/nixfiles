import { Context, Effect, Layer, Stream, type Scope } from 'effect';
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
