import { assert } from '@effect/vitest';
import { Effect, Layer, Ref } from 'effect';
import * as Mpris from '../src/mpris.ts';
import { IntegrationError } from '../src/errors.ts';
export const spotify = Effect.gen(function* () {
  const state = yield* Ref.make<Mpris.State>({
    status: 'Playing',
    title: 'Life Will Change',
    artists: ['Lyn'],
    canControl: true,
    canNext: true,
    canPrevious: true,
    canPlay: true,
    canPause: true,
    canSeek: true,
    shuffle: false,
    loop: 'None',
    trackId: '/com/spotify/track/one',
    durationMicros: 300_000_000,
    positionMicros: 90_000_000,
    sampledAt: 0,
    rate: 1,
    artUrl: null,
  });
  const mode = yield* Ref.make<'online' | 'offline' | 'malformed'>('online');
  const requests: ReadonlyArray<string>[] = [];
  const layer = Layer.succeed(Mpris.MprisTransport, {
    ready: Effect.void,
    run: (args) =>
      Effect.gen(function* () {
        requests.push(args);
        assert.deepStrictEqual(args.slice(0, 4), [
          '--user',
          '--json=short',
          '--timeout=2s',
          '--auto-start=no',
        ]);
        const connection = yield* Ref.get(mode);
        if (connection === 'offline')
          return yield* Effect.fail(new IntegrationError({ message: 'Spotify absent' }));
        if (args[4] === 'list')
          return JSON.stringify([{ name: 'org.mpris.MediaPlayer2.spotify', process: 'spotify' }]);
        assert.strictEqual(args[5], 'org.mpris.MediaPlayer2.spotify');
        if (args[8] === 'GetAll') {
          assert.strictEqual(args[7], 'org.freedesktop.DBus.Properties');
          assert.deepStrictEqual(args.slice(9), ['s', 'org.mpris.MediaPlayer2.Player']);
          if (connection === 'malformed')
            return '{"type":"a{sv}","data":[{"PlaybackStatus":{"type":"s","data":"maybe"}}]}';
          const value = yield* Ref.get(state);
          const bool = (data: boolean) => ({ type: 'b', data });
          return JSON.stringify({
            type: 'a{sv}',
            data: [
              {
                PlaybackStatus: { type: 's', data: value.status },
                Position: { type: 'x', data: value.positionMicros },
                Rate: { type: 'd', data: value.rate },
                CanControl: bool(value.canControl),
                CanGoNext: bool(value.canNext),
                CanGoPrevious: bool(value.canPrevious),
                CanPlay: bool(value.canPlay),
                CanPause: bool(value.canPause),
                CanSeek: bool(value.canSeek),
                ...(value.shuffle === null ? {} : { Shuffle: bool(value.shuffle) }),
                ...(value.loop === null ? {} : { LoopStatus: { type: 's', data: value.loop } }),
                Metadata: {
                  type: 'a{sv}',
                  data: {
                    'xesam:title': { type: 's', data: value.title },
                    'xesam:artist': { type: 'as', data: value.artists },
                    'mpris:trackid': { type: 'o', data: value.trackId },
                    'mpris:length': { type: 'x', data: value.durationMicros },
                    ...(value.artUrl ? { 'mpris:artUrl': { type: 's', data: value.artUrl } } : {}),
                  },
                },
              },
            ],
          });
        }
        assert.strictEqual(args[7], 'org.mpris.MediaPlayer2.Player');
        if (args[4] === 'set-property') {
          if (args[8] === 'Shuffle')
            yield* Ref.update(state, (before) => ({ ...before, shuffle: args[10] === 'true' }));
          else
            yield* Ref.update(state, (before) => ({
              ...before,
              loop: args[10] as Mpris.State['loop'],
            }));
        } else if (args[8] === 'PlayPause')
          yield* Ref.update(
            state,
            (before): Mpris.State => ({
              ...before,
              status: before.status === 'Playing' ? 'Paused' : 'Playing',
            }),
          );
        else if (args[8] === 'Play' || args[8] === 'Pause' || args[8] === 'Stop')
          yield* Ref.update(
            state,
            (before): Mpris.State => ({
              ...before,
              status: args[8] === 'Play' ? 'Playing' : args[8] === 'Pause' ? 'Paused' : 'Stopped',
            }),
          );
        return '';
      }),
  });
  return {
    layer,
    state,
    mode,
    requests,
    change: (patch: Partial<Mpris.State>) =>
      Ref.update(state, (before) => ({ ...before, ...patch })),
  };
});
