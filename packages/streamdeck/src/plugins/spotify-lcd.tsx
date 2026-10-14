import { invariant } from '../errors.ts';
import { Clock, Effect, Option, Ref } from 'effect';
import { MixerCards } from '../mixer-cards.ts';
import * as Mpris from '../mpris.ts';
import * as Takumi from '../takumi.ts';
import { NowPlayingCard } from '../ui/now-playing-card.tsx';
import type { Controller } from './spotify-player.ts';
import { keyForApplication } from './spotify-player.ts';
import * as Artwork from './spotify-artwork.ts';
const volumeFeedbackMillis = 1500;
/** Registers content, not hardware claims. The mixer remains the sole LCD compositor. */
export const register = (api: Controller) =>
  Effect.gen(function* () {
    const cards = yield* MixerCards;
    const renderer = yield* Takumi.current;
    const supplied = yield* Effect.serviceOption(Artwork.SpotifyArtwork);
    const artwork = Option.isSome(supplied) ? supplied.value : yield* Artwork.live;
    const visible = yield* Ref.make<ReadonlySet<string>>(new Set());
    const volumeUntil = yield* Ref.make<ReadonlyMap<string, number>>(new Map());
    const state = (key: string) => (api.forApplication ? api.forApplication(key) : api.state);
    yield* cards.register({
      id: 'spotify-now-playing',
      matches: (app) => keyForApplication(app.key) !== undefined,
      expandIntoEmpty: true,
      placement: 'last',
      retain:
        api.applications ??
        api.state.pipe(
          Effect.map((track) => (track.title ? [{ key: 'spotify', name: 'Spotify' }] : [])),
          Effect.orElseSucceed(() => []),
        ),
      tap: {
        label: 'Basculer volume / piste en cours',
        run: (app) =>
          Effect.gen(function* () {
            const key = invariant(keyForApplication(app.key), 'spotify-lcd');
            yield* Ref.update(volumeUntil, (before) => {
              const next = new Map(before);
              next.delete(key);
              return next;
            });
            yield* Ref.update(visible, (before) => {
              const next = new Set(before);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            });
          }),
      },
      onAdjust: (app, change) =>
        Effect.gen(function* () {
          if (!change.delta) return;
          const until = (yield* Clock.currentTimeMillis) + volumeFeedbackMillis;
          yield* Ref.update(volumeUntil, (before) =>
            new Map(before).set(invariant(keyForApplication(app.key), 'spotify-lcd'), until),
          );
        }),
      frame: (app, size) =>
        Effect.gen(function* () {
          const key = invariant(keyForApplication(app.key), 'spotify-lcd');
          if (!(yield* Ref.get(visible)).has(key)) return undefined;
          const now = yield* Clock.currentTimeMillis;
          const volumeOverlay = now < ((yield* Ref.get(volumeUntil)).get(key) ?? 0);
          const track = yield* state(key).pipe(Effect.orElseSucceed(() => undefined));
          if (!track) return undefined;
          const sampled = Mpris.positionAt(track, now);
          const position = sampled === null ? null : Math.floor(sampled / 1000000) * 1000000;
          const cover =
            size.width >= 320 || volumeOverlay ? yield* artwork.current(track.artUrl) : undefined;
          return {
            stamp: JSON.stringify([
              size,
              track.title,
              track.artists,
              track.trackId,
              track.artUrl,
              cover !== undefined,
              volumeOverlay,
              track.status,
              position,
              track.durationMicros,
              app.muted,
              Math.round(app.volume),
              app.streams.length > 0,
            ]),
            draw: renderer
              .rgb(
                <NowPlayingCard
                  {...size}
                  app={app}
                  track={track}
                  position={position}
                  cover={cover}
                  volumeOverlay={volumeOverlay}
                />,
                size,
              )
              .pipe(
                Effect.catch(() =>
                  renderer.rgb(
                    <NowPlayingCard
                      {...size}
                      app={app}
                      track={track}
                      position={position}
                      volumeOverlay={volumeOverlay}
                    />,
                    size,
                  ),
                ),
              ),
          };
        }),
    });
  });
