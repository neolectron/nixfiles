import { Deferred, Effect, Layer, Ref } from 'effect';
import { IntegrationError } from '../src/errors.ts';
import { type Message } from '../src/json-socket.ts';
import { DiscordTransport } from '../src/discord-ipc.ts';
import type { VoiceState } from '../src/discord-rpc.ts';
export const discord = Effect.gen(function* () {
  const state = yield* Ref.make({ mute: true, deaf: false });
  const sent: Array<Message> = [];
  let receive: ((frame: Message) => Effect.Effect<void, IntegrationError>) | undefined;
  let failed: Deferred.Deferred<never, IntegrationError> | undefined;
  let opens = 0;
  let closes = 0;
  const layer = Layer.succeed(DiscordTransport, {
    connect: (_url, receiver) =>
      Effect.gen(function* () {
        opens++;
        const failure = yield* Deferred.make<never, IntegrationError>();
        failed = failure;
        receive = receiver;
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            closes++;
            if (receive === receiver) receive = undefined;
            if (failed === failure) failed = undefined;
          }),
        );
        yield* receiver({ evt: 'READY', data: {} });
        return {
          failure: Deferred.await(failure),
          send: (frame: Message) =>
            Effect.gen(function* () {
              sent.push(frame);
              if (frame.cmd === 'SET_VOICE_SETTINGS')
                yield* Ref.update(state, (before) => ({
                  ...before,
                  ...(frame.args as { mute?: boolean; deaf?: boolean }),
                }));
              yield* receiver({
                nonce: frame.nonce,
                cmd: frame.cmd,
                data:
                  frame.cmd === 'GET_VOICE_SETTINGS' || frame.cmd === 'SET_VOICE_SETTINGS'
                    ? yield* Ref.get(state)
                    : {},
              });
            }),
        };
      }),
  });
  const change = (next: VoiceState) =>
    Ref.set(state, next).pipe(
      Effect.andThen(
        Effect.suspend(
          () =>
            receive?.({ cmd: 'DISPATCH', evt: 'VOICE_SETTINGS_UPDATE', data: next }) ?? Effect.void,
        ),
      ),
    );
  return {
    layer,
    sent,
    change,
    counts: () => ({ opens, closes }),
    disconnect: Effect.suspend(() =>
      failed
        ? Deferred.fail(failed, new IntegrationError({ message: 'Disconnected' })).pipe(
            Effect.asVoid,
          )
        : Effect.void,
    ),
  };
});
