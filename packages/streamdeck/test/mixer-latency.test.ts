import { assert, it } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import { Clock, Console, Deferred, Effect, Layer, Ref } from 'effect';
import * as Audio from '@nixfiles/system-control/audio.ts';
import * as Mock from '../src/mock.ts';
import { make as makeMixer } from '../src/plugins/audio-mixer.ts';

const backend = Effect.gen(function* () {
  const volume = yield* Ref.make(50);
  const applied = yield* Deferred.make<void>();
  let total = 0;
  let reads = 0;
  const commands: Audio.Change[] = [];
  return {
    volume,
    applied,
    commands,
    reads: () => reads,
    resetReads: () => {
      reads = 0;
    },
    layer: Audio.makeLayer({
      list: Effect.gen(function* () {
        reads++;
        return [
          {
            key: 'test',
            name: 'Test',
            streams: [],
            muted: false,
            mixedMute: false,
            paused: false,
            volume: yield* Ref.get(volume),
          },
        ];
      }),
      master: Effect.succeed(undefined),
      changeMaster: () => Effect.void,
      change: (_, change) =>
        Effect.gen(function* () {
          commands.push(change);
          yield* Ref.update(volume, (before) => before + change.delta);
          total += change.delta;
          if (total === 40) yield* Deferred.succeed(applied, undefined);
        }),
    }),
  };
});

it.live('a stalled LCD cannot delay knob input or subsequent audio batches; no crank is lost', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const blocked = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let stall = false;
      const mock = Mock.make({
        onWrite: (write) =>
          stall && write.kind === 'region'
            ? Deferred.succeed(blocked, undefined).pipe(Effect.andThen(Deferred.await(release)))
            : Effect.void,
      });
      const audio = yield* backend;
      yield* Effect.gen(function* () {
        const mixer = yield* makeMixer();
        yield* mixer.run.pipe(Effect.forkScoped);
        // Force the presentation worker into an indefinitely slow native display.
        stall = true;
        yield* Ref.set(audio.volume, 60);
        yield* (yield* Audio.Audio).refresh;
        yield* Deferred.await(blocked);
        yield* Effect.gen(function* () {
          const started = yield* Clock.currentTimeMillis;
          for (let i = 0; i < 10; i++) yield* mock.emit({ _tag: 'DialRotate', dial: 0, delta: 1 });
          // Let the first batch finish while LCD is still blocked, then send another.
          yield* Effect.sleep(80);
          for (let i = 0; i < 10; i++) yield* mock.emit({ _tag: 'DialRotate', dial: 0, delta: 1 });
          yield* Deferred.await(audio.applied).pipe(Effect.timeout('1 second'));
          assert.strictEqual(yield* Ref.get(audio.volume), 100);
          assert.ok(audio.commands.length <= 3);
          yield* Console.log(
            JSON.stringify({
              benchmark: 'knobs-with-blocked-lcd',
              milliseconds: (yield* Clock.currentTimeMillis) - started,
              cranks: 20,
              audioBatches: audio.commands.length,
            }),
          );
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
      }).pipe(Effect.provide(Layer.merge(mock.layer(), audio.layer)));
    }),
  ).pipe(Effect.provide(NodeServices.layer), Effect.timeout('5 seconds')),
);

it.live('a flush reuses the audio service confirmation instead of rereading the system twice', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const audio = yield* backend;
      yield* Effect.gen(function* () {
        const mixer = yield* makeMixer();
        audio.resetReads();
        yield* mixer.adjustDial(0, 1);
        yield* mixer.flush;
        assert.strictEqual(audio.reads(), 1);
        assert.strictEqual((yield* mixer.state).apps[0]?.volume, 52);
      }).pipe(Effect.provide(Layer.merge(Mock.make().layer(), audio.layer)));
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);
