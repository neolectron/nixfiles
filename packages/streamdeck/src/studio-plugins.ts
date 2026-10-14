import { Clock, Effect, Stream } from 'effect';
import type { make } from './plugin-host.ts';
import * as Sources from './sources.ts';
import * as EventDisplay from './plugins/event-display.ts';

/** Register personal plugins here. New plugins start disabled unless saved otherwise. */
export const configure = (host: Effect.Success<typeof make>) => Effect.gen(function*() {
  const ticks = Sources.poll(Clock.currentTimeMillis, '1 second').pipe(Stream.map((millis) => `Tick ${Math.floor(millis / 1000) % 1000}`));
  yield* host.install(EventDisplay.plugin(ticks));
});
