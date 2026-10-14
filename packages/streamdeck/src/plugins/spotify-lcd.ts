import { Clock, Effect, Ref } from 'effect';
import { createElement as h } from 'react';
import { MixerCards } from '../mixer-cards.ts';
import * as Mpris from '../mpris.ts';
import * as Takumi from '../takumi.ts';
import { NowPlayingCard } from '../ui/now-playing-card.ts';
import type { Controller } from './spotify-player.ts';
import { keyForApplication } from './spotify-player.ts';

const volumeFeedbackMillis = 1500;

/** Registers content, not hardware claims. The mixer remains the sole LCD compositor. */
export const register = (api: Controller) => Effect.gen(function*() {
  const cards = yield* MixerCards; const renderer = yield* Takumi.current;
  const visible = yield* Ref.make<ReadonlySet<string>>(new Set());
  const volumeUntil = yield* Ref.make<ReadonlyMap<string, number>>(new Map());
  const state = (key: string) => api.forApplication ? api.forApplication(key) : api.state;
  yield* cards.register({ id: 'spotify-now-playing', matches: (app) => keyForApplication(app.key) !== undefined,
    retain: api.applications ?? api.state.pipe(Effect.map((track) => track.title ? [{ key: 'spotify', name: 'Spotify' }] : []), Effect.orElseSucceed(() => [])),
    tap: { label: 'Basculer volume / piste en cours', run: (app) => Effect.gen(function*() {
      const key = keyForApplication(app.key)!;
      yield* Ref.update(volumeUntil, (before) => { const next = new Map(before); next.delete(key); return next; });
      yield* Ref.update(visible, (before) => { const next = new Set(before); if (next.has(key)) next.delete(key); else next.add(key); return next; });
    }) },
    onAdjust: (app, change) => Effect.gen(function*() {
      if (!change.delta) return;
      const until = (yield* Clock.currentTimeMillis) + volumeFeedbackMillis;
      yield* Ref.update(volumeUntil, (before) => new Map(before).set(keyForApplication(app.key)!, until));
    }),
    frame: (app, size) => Effect.gen(function*() {
      const key = keyForApplication(app.key)!;
      if (!(yield* Ref.get(visible)).has(key)) return undefined;
      const now = yield* Clock.currentTimeMillis;
      if (now < ((yield* Ref.get(volumeUntil)).get(key) ?? 0)) return undefined;
      const track = yield* state(key).pipe(Effect.orElseSucceed(() => undefined)); if (!track) return undefined;
      const sampled = Mpris.positionAt(track, now);
      const position = sampled === null ? null : Math.floor(sampled / 1_000_000) * 1_000_000;
      return { stamp: JSON.stringify([size, track.title, track.artists, track.trackId, track.status, position, track.durationMicros, app.muted, Math.round(app.volume), app.streams.length > 0]),
        draw: renderer.rgb(h(NowPlayingCard, { ...size, app, track, position }), size) };
    }),
  });
});
