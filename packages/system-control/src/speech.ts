import { Activity } from './speech-contract.ts';
import {
  Config,
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Result,
  Schema,
  Semaphore,
  Stream,
} from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { IntegrationError } from './errors.ts';
import * as State from './state.ts';

export class SpeechBackend extends Context.Service<
  SpeechBackend,
  {
    readonly capture: (
      released: Effect.Effect<void>,
      transcribing: Effect.Effect<void>,
    ) => Effect.Effect<string, IntegrationError>;
  }
>()('@nixfiles/system-control/SpeechBackend') {
  static readonly layer = Layer.effect(
    SpeechBackend,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const processes = yield* ChildProcessSpawner.ChildProcessSpawner;
      const recorder = yield* Config.String('STREAMDECK_RECORDER_COMMAND').pipe(
        Config.withDefault('pw-record'),
      );
      const transcriber = yield* Config.String('STREAMDECK_TRANSCRIBE_COMMAND').pipe(
        Config.withDefault('handy'),
      );
      const model = yield* Config.String('STREAMDECK_TRANSCRIBE_MODEL').pipe(Config.option);
      return {
        capture: (released: Effect.Effect<void>, transcribing: Effect.Effect<void>) =>
          Effect.scoped(
            Effect.gen(function* () {
              const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'notes-dictation-' });
              const wav = `${directory}/speech.wav`;
              const recording = yield* processes.spawn(
                ChildProcess.make(
                  recorder,
                  [
                    '--rate',
                    '16000',
                    '--channels',
                    '1',
                    '--format',
                    's16',
                    '--container',
                    'wav',
                    '--media-category',
                    'Capture',
                    wav,
                  ],
                  { stdin: 'ignore', forceKillAfter: '500 millis' },
                ),
              );
              yield* Effect.forkScoped(Stream.runDrain(recording.stdout));
              yield* Effect.forkScoped(Stream.runDrain(recording.stderr));
              yield* Effect.raceFirst(
                released,
                recording.exitCode.pipe(
                  Effect.andThen(
                    Effect.fail(
                      new IntegrationError({
                        message: 'La capture du microphone s’est interrompue.',
                      }),
                    ),
                  ),
                ),
              ).pipe(Effect.timeout('2 minutes'));
              yield* recording.kill({ killSignal: 'SIGINT', forceKillAfter: '500 millis' });
              yield* recording.exitCode.pipe(Effect.timeout('3 seconds'));
              if (Number((yield* fs.stat(wav)).size) <= 44) return '';
              yield* transcribing;
              const worker = yield* processes.spawn(
                ChildProcess.make(
                  transcriber,
                  [
                    '--transcribe-file',
                    wav,
                    '--json',
                    ...(Option.isSome(model) ? ['--model', model.value] : []),
                  ],
                  { stdin: 'ignore', forceKillAfter: '1 second' },
                ),
              );
              const [code, text] = yield* Effect.all(
                [
                  worker.exitCode,
                  Stream.mkString(Stream.decodeText(worker.stdout)),
                  Stream.runDrain(worker.stderr),
                ],
                { concurrency: 'unbounded' },
              );
              if (code !== 0)
                return yield* new IntegrationError({
                  message:
                    'Transcription Handy impossible. Vérifie qu’un modèle local est installé.',
                });
              return (yield* Schema.decodeUnknownEffect(
                Schema.fromJsonString(
                  Schema.Struct({ text: Schema.String.check(Schema.isMaxLength(64000)) }),
                ),
              )(text)).text;
            }),
          ).pipe(
            Effect.timeout('5 minutes'),
            Effect.mapError((error) =>
              error instanceof IntegrationError
                ? error
                : new IntegrationError({
                    message: 'Dictée indisponible, capture annulée ou délai dépassé.',
                  }),
            ),
          ),
      };
    }),
  );
}
export const make = Effect.gen(function* () {
  const backend = yield* SpeechBackend;
  const lock = yield* Semaphore.make(1);
  const store = yield* State.make<Activity, IntegrationError>(
    new IntegrationError({ message: 'Le service de dictée est fermé.' }),
  );
  const idle: Activity = { target: null, phase: 'idle' };
  yield* store.publish(Result.succeed(idle));
  return {
    activity: store.state,
    capture: (target: string, released: Effect.Effect<void>) =>
      store.guard(
        Effect.gen(function* () {
          const value = yield* Semaphore.withPermitsIfAvailable(
            lock,
            1,
          )(
            store
              .publish(Result.succeed({ target, phase: 'recording' }))
              .pipe(
                Effect.andThen(
                  backend.capture(
                    released,
                    store.publish(Result.succeed({ target, phase: 'transcribing' })),
                  ),
                ),
                Effect.ensuring(store.publish(Result.succeed(idle))),
              ),
          );
          return Option.isSome(value)
            ? value.value
            : yield* new IntegrationError({ message: 'Une dictée est déjà en cours.' });
        }),
      ),
  };
});
export type Controller = Effect.Success<typeof make>;
export class Speech extends Context.Service<Speech, Controller>()(
  '@nixfiles/system-control/Speech',
) {
  static readonly serviceLayer = Layer.effect(Speech, make);
  static readonly layer = Speech.serviceLayer.pipe(Layer.provide(SpeechBackend.layer));
}
