import { assert, it } from '@effect/vitest';
import { NodeCrypto } from '@effect/platform-node';
import { Deferred, Effect, Ref, Redacted, Result, Schedule } from 'effect';
import { JsonSocket, type Message } from '../src/json-socket.ts';
import { IntegrationError } from '../src/errors.ts';
import { make } from '../src/obs.ts';

it.live(
  'OBS stays available offline, reconnects, correlates requests and cleans up on scope close',
  () =>
    Effect.gen(function* () {
      const online = yield* Ref.make(false);
      const disconnected = yield* Deferred.make<never, IntegrationError>();
      let attempts = 0;
      let closed = 0;
      const sent: Message[] = [];
      const api = yield* Effect.scoped(
        Effect.gen(function* () {
          const obs = yield* make({ url: 'ws://fake', password: Redacted.make('') }).pipe(
            Effect.provideService(JsonSocket, {
              connect: (_url, receive) =>
                Effect.gen(function* () {
                  attempts++;
                  if (!(yield* Ref.get(online)))
                    return yield* new IntegrationError({ message: 'Offline' });
                  yield* Effect.addFinalizer(() =>
                    Effect.sync(() => {
                      closed++;
                    }),
                  );
                  yield* receive({ op: 0, d: {} });
                  return {
                    failure: Deferred.await(disconnected),
                    send: (frame) => {
                      sent.push(frame);
                      return frame.op === 1
                        ? receive({ op: 2, d: {} })
                        : receive({
                            op: 7,
                            d: {
                              requestId: (frame.d as Message).requestId,
                              requestStatus: { result: true },
                              responseData: { outputActive: false },
                            },
                          });
                    },
                  };
                }),
            }),
          );
          assert.ok(Result.isFailure(yield* Effect.result(obs.request('GetRecordStatus'))));
          yield* Ref.set(online, true);
          yield* obs.state.pipe(Effect.retry(Schedule.spaced(5)), Effect.timeout('3 seconds'));
          assert.deepStrictEqual(yield* obs.request('GetRecordStatus'), { outputActive: false });
          assert.ok(
            sent.every(
              (frame) => frame.op !== 6 || (frame.d as Message).requestType === 'GetRecordStatus',
            ),
          );
          yield* Ref.set(online, false);
          yield* Deferred.fail(disconnected, new IntegrationError({ message: 'Disconnected' }));
          yield* Effect.repeat(obs.snapshot, {
            until: Result.isFailure,
            schedule: Schedule.spaced(5),
          });
          assert.ok(Result.isFailure(yield* Effect.result(obs.request('GetRecordStatus'))));
          return obs;
        }),
      );
      const before = attempts;
      yield* Effect.sleep('1100 millis');
      assert.strictEqual(attempts, before);
      assert.strictEqual(closed, 1);
      assert.ok(Result.isFailure(yield* Effect.result(api.request('GetRecordStatus'))));
    }).pipe(Effect.provide(NodeCrypto.layer), Effect.timeout('6 seconds')),
);
