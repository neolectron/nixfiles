import { Effect, PubSub, Stream } from 'effect';
import type { DeckEvent } from './model.ts';
import { StreamDeck, type Device } from './stream-deck.ts';

/** A scoped logical input source; plugins see browser input through their ordinary device subscription. */
export const make = (original: Device) =>
  Effect.gen(function* () {
    const hub = yield* Effect.acquireRelease(PubSub.bounded<DeckEvent>(256), PubSub.shutdown);
    const subscribe = Effect.gen(function* () {
      const browser = yield* PubSub.subscribe(hub);
      const physical = yield* original.subscribe;
      return Stream.merge(Stream.fromEffectRepeat(PubSub.take(browser)), physical);
    });
    return {
      device: StreamDeck.of({ ...original, subscribe, events: Stream.unwrap(subscribe) }),
      emit: (event: DeckEvent) => PubSub.publish(hub, event).pipe(Effect.asVoid),
    };
  });
