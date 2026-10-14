import { Clock, Effect, Ref } from 'effect';
import { createElement as h } from 'react';
import { MixerCards } from '../mixer-cards.ts';
import * as Mpris from '../mpris.ts';
import * as Takumi from '../takumi.ts';
import { NowPlayingCard } from '../ui/now-playing-card.ts';
import type { Controller } from './spotify-player.ts';
import { keyForApplication } from './spotify-player.ts';

/** Registers content, not hardware claims. The mixer remains the sole LCD compositor. */
export const register = (api: Controller) => Effect.gen(function*() {
  const cards = yield* MixerCards; const renderer = yield* Takumi.current;
  const visible = yield* Ref.make<ReadonlySet<string>>(new Set());
  const state = (key: string) => api.forApplication ? api.forApplication(key) : api.state;
  yield* cards.register({ id: 'spotify-now-playing', matches: (app) => keyForApplication(app.key) !== undefined,
    retain: api.applications ?? api.state.pipe(Effect.map((track) => track.title ? [{ key: 'spotify', name: 'Spotify' }] : []), Effect.orElseSucceed(() => [])),
    tap: { label: 'Basculer volume / piste en cours', run: (app) => Ref.update(visible, (before) => {
      const key = keyForApplication(app.key)!; const next = new Set(before); if (next.has(key)) next.delete(key); else next.add(key); return next;
    }) },
    frame: (app, size) => Effect.gen(function*() {
      const key = keyForApplication(app.key)!;
      if (!(yield* Ref.get(visible)).has(key)) return undefined;
      const track = yield* state(key).pipe(Effect.orElseSucceed(() => undefined)); if (!track) return undefined;
      const sampled = Mpris.positionAt(track, yield* Clock.currentTimeMillis);
      const position = sampled === null ? null : Math.floor(sampled / 1_000_000) * 1_000_000;
      return { stamp: JSON.stringify([size, track.title, track.artists, track.trackId, track.status, position, track.durationMicros, app.muted, Math.round(app.volume), app.streams.length > 0]),
        draw: renderer.rgb(h(NowPlayingCard, { ...size, app, track, position }), size) };
    }),
  });
});
