import { Clock, Effect, Stream } from 'effect';
import { PluginHost } from '../plugin-host.ts';
import * as EventDisplay from '../plugins/event-display.ts';
import * as Sources from '../sources.ts';
import { StreamDeck } from '../stream-deck.ts';

/** Edit the source or plugin implementation; USB, rendering and cleanup stay in the library. */
export const playground = Effect.gen(function*() {
  const host = yield* PluginHost; const deck = yield* StreamDeck;
  const source = Sources.poll(Clock.currentTimeMillis, '1 second').pipe(Stream.map((millis) => `Tick ${Math.floor(millis / 1000) % 1000}`));
  const display = yield* host.install(EventDisplay.plugin(source));
  yield* host.setEnabled(display.id, true);
  yield* deck.awaitFailure;
}).pipe(Effect.provide(PluginHost.layer));
