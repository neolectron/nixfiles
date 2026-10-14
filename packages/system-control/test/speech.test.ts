import { assert, it } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import {
  ConfigProvider,
  Context,
  Deferred,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Ref,
  Result,
  Schedule,
} from 'effect';
import { SpeechBackend, make } from '../src/speech.ts';

it.effect(
  'dictation owns one capture, exposes its phases and stops on release or cancellation',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const finish = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const stopped = yield* Ref.make(0);
        const api = yield* make.pipe(
          Effect.provideService(SpeechBackend, {
            capture: (released, transcribing) =>
              Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(released),
                Effect.andThen(transcribing),
                Effect.andThen(Deferred.await(finish)),
                Effect.as('Bonjour.'),
                Effect.ensuring(Ref.update(stopped, (n) => n + 1)),
              ),
          }),
        );
        assert.deepStrictEqual(yield* api.activity, { target: null, phase: 'idle' });
        const job = yield* Effect.forkScoped(api.capture('ideas', Deferred.await(release)));
        yield* Deferred.await(entered);
        assert.deepStrictEqual(yield* api.activity, { target: 'ideas', phase: 'recording' });
        assert.ok(Result.isFailure(yield* Effect.result(api.capture('other', Effect.void))));
        yield* Deferred.succeed(release, undefined);
        yield* Effect.repeat(api.activity, { until: (s) => s.phase === 'transcribing' });
        yield* Deferred.succeed(finish, undefined);
        assert.strictEqual(yield* Fiber.join(job), 'Bonjour.');
        const held = yield* Effect.forkScoped(api.capture('ideas', Effect.never));
        yield* Effect.repeat(api.activity, { until: (s) => s.phase === 'recording' });
        yield* Fiber.interrupt(held);
        assert.strictEqual(yield* Ref.get(stopped), 2);
        assert.deepStrictEqual(yield* api.activity, { target: null, phase: 'idle' });
      }),
    ),
);

const transport = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'speech-test-' });
  yield* fs.writeFileString(
    `${root}/record`,
    `#!/usr/bin/env python3
import signal, sys, time, wave
audio = wave.open(sys.argv[-1], 'wb')
audio.setnchannels(1)
audio.setsampwidth(2)
audio.setframerate(16000)
audio.writeframes(b'\\0' * 32000)
def stop(*_):
    audio.close()
    open('${root}/stopped', 'w').write('yes')
    sys.exit(0)
signal.signal(signal.SIGINT, stop)
open('${root}/wav', 'w').write(sys.argv[-1])
while True: time.sleep(.01)
`,
    { mode: 0o700 },
  );
  yield* fs.writeFileString(
    `${root}/transcribe`,
    `#!/usr/bin/env python3
import json, sys, wave
audio = wave.open(sys.argv[2])
assert audio.getframerate() == 16000 and audio.getnchannels() == 1
open('${root}/args', 'w').write(json.dumps(sys.argv[1:]))
print(json.dumps({'text': 'Bonjour la note.'}))
`,
    { mode: 0o700 },
  );
  const context = yield* Layer.build(SpeechBackend.layer).pipe(
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromEnvRecord({
        STREAMDECK_RECORDER_COMMAND: `${root}/record`,
        STREAMDECK_TRANSCRIBE_COMMAND: `${root}/transcribe`,
        STREAMDECK_TRANSCRIBE_MODEL: 'literal $(not-a-command)',
      }),
    ),
  );
  const ready = Effect.repeat(fs.exists(`${root}/wav`), {
    until: Boolean,
    schedule: Schedule.spaced('10 millis'),
  });
  return { fs, root, ready, backend: Context.get(context, SpeechBackend) };
});

it.live(
  'audio transport gracefully closes WAV, passes literal arguments and deletes temporary audio',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { fs, root, ready, backend } = yield* transport;
        const release = yield* Deferred.make<void>();
        let transcribed = false;
        const job = yield* Effect.forkScoped(
          backend.capture(
            Deferred.await(release),
            Effect.sync(() => {
              transcribed = true;
            }),
          ),
        );
        yield* ready;
        const wav = yield* fs.readFileString(`${root}/wav`);
        yield* Deferred.succeed(release, undefined);
        assert.strictEqual(yield* Fiber.join(job), 'Bonjour la note.');
        assert.ok(transcribed);
        assert.strictEqual(yield* fs.exists(`${root}/stopped`), true);
        assert.strictEqual(yield* fs.exists(wav), false);
        assert.deepStrictEqual(JSON.parse(yield* fs.readFileString(`${root}/args`)), [
          '--transcribe-file',
          wav,
          '--json',
          '--model',
          'literal $(not-a-command)',
        ]);
      }),
    ).pipe(Effect.provide(NodeServices.layer), Effect.timeout('10 seconds')),
);

it.live(
  'cancelling a recording reaps the child and removes audio without running transcription',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { fs, root, ready, backend } = yield* transport;
        const job = yield* Effect.forkScoped(backend.capture(Effect.never, Effect.void));
        yield* ready;
        const wav = yield* fs.readFileString(`${root}/wav`);
        yield* Fiber.interrupt(job);
        assert.strictEqual(yield* fs.exists(wav), false);
        assert.strictEqual(yield* fs.exists(`${root}/args`), false);
      }),
    ).pipe(Effect.provide(NodeServices.layer), Effect.timeout('10 seconds')),
);
