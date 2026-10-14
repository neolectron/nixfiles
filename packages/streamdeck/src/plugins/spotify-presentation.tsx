import { useEffect, useState } from 'react';
import { Clock, Effect, Fiber, Schedule, Schema } from 'effect';
import * as Presentation from '../presentation.tsx';
import { NowPlayingCard } from '../ui/now-playing-card.tsx';
import { positionAt } from '@nixfiles/system-control/mpris-clock.ts';

const finite = Schema.Number.check(Schema.isFinite());
const nonnegative = finite.check(Schema.isGreaterThanOrEqualTo(0));
export const Data = Schema.Struct({
  width: Presentation.Dimension,
  height: Presentation.Dimension,
  app: Schema.Struct({
    name: Schema.String,
    volume: nonnegative,
    muted: Schema.Boolean,
    hasAudio: Schema.Boolean,
  }),
  track: Schema.Struct({
    title: Schema.String,
    artists: Schema.Array(Schema.String),
    status: Schema.Literals(['Playing', 'Paused', 'Stopped']),
    durationMicros: Schema.NullOr(nonnegative),
    positionMicros: Schema.NullOr(nonnegative),
    sampledAt: finite,
    rate: finite,
  }),
  cover: Schema.NullOr(Schema.String),
  volumeUntil: finite,
});
export type Data = typeof Data.Type;

function SpotifyView({ value }: { value: Data }) {
  const [now, setNow] = useState(() => Date.now());
  const animate = value.track.status === 'Playing' || value.volumeUntil > now;
  useEffect(() => {
    if (!animate) return;
    const fiber = Effect.runFork(
      Effect.repeat(
        Clock.currentTimeMillis.pipe(Effect.tap((time) => Effect.sync(() => setNow(time)))),
        Schedule.spaced(100),
      ),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [animate]);
  return (
    <NowPlayingCard
      {...value}
      position={positionAt(value.track, now)}
      cover={value.cover ?? undefined}
      volumeOverlay={now < value.volumeUntil}
    />
  );
}
export const presentation = Presentation.define('spotify.now-playing.v1', Data, SpotifyView);
