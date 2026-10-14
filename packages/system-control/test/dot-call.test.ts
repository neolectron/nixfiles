import { assert, it } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import {
  Clock,
  ConfigProvider,
  Context,
  Effect,
  FileSystem,
  Layer,
  Ref,
  Result,
  Schema,
} from 'effect';
import { TestClock } from 'effect/testing';
import { DotCallBackend, Status, idle, make } from '../src/dot-call.ts';
import { IntegrationError } from '../src/errors.ts';

const fixture = Effect.gen(function* () {
  const current = yield* Ref.make<Result.Result<Status, IntegrationError>>(Result.succeed(idle));
  let reads = 0;
  let calls = 0;
  const stopped: string[] = [];
  const backend = {
    read: Effect.sync(() => reads++).pipe(
      Effect.andThen(Ref.get(current)),
      Effect.flatMap(Effect.fromResult),
    ),
    call: Effect.gen(function* () {
      calls++;
      const value: Status = { phase: 'connecting', callId: `call-${calls}`, startedAt: null };
      yield* Ref.set(current, Result.succeed(value));
      return value;
    }),
    hangup: (id: string) =>
      Effect.sync(() => stopped.push(id)).pipe(
        Effect.andThen(Ref.set(current, Result.succeed(idle))),
        Effect.as(idle),
      ),
  };
  return { current, backend, calls: () => calls, reads: () => reads, stopped };
});

it('call status requires a real identifier and start timestamp for an active call', () => {
  assert.throws(() =>
    Schema.decodeUnknownSync(Status)({ phase: 'active', callId: 'call', startedAt: null }),
  );
  assert.throws(() =>
    Schema.decodeUnknownSync(Status)({ phase: 'active', callId: '', startedAt: 0 }),
  );
  assert.throws(() =>
    Schema.decodeUnknownSync(Status)({ phase: 'idle', callId: 'call', startedAt: 0 }),
  );
});

it.effect('calls are idempotent and a real connection timestamp drives the timer and toggle', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const test = yield* fixture;
      const api = yield* make.pipe(Effect.provideService(DotCallBackend, test.backend));
      assert.strictEqual(test.calls(), 0);
      yield* Effect.all([api.call, api.call], { concurrency: 'unbounded' });
      assert.strictEqual(test.calls(), 1);
      yield* TestClock.adjust('5 seconds');
      assert.strictEqual((yield* api.view).elapsedSeconds, 0);
      const startedAt = yield* Clock.currentTimeMillis;
      yield* Ref.set(
        test.current,
        Result.succeed({ phase: 'active', callId: 'call-1', startedAt }),
      );
      yield* api.refresh;
      yield* TestClock.adjust('61 seconds');
      assert.strictEqual((yield* api.view).elapsedSeconds, 61);
      yield* api.toggle;
      assert.deepStrictEqual(test.stopped, ['call-1']);
      assert.strictEqual((yield* api.view).phase, 'idle');
      yield* api.hangup;
      assert.deepStrictEqual(test.stopped, ['call-1']);
    }),
  ),
);

it.effect(
  'externally started and ended calls, offline state and reconnection are observed without calling',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const test = yield* fixture;
        yield* Ref.set(
          test.current,
          Result.fail(new IntegrationError({ message: 'Not connected' })),
        );
        const api = yield* make.pipe(Effect.provideService(DotCallBackend, test.backend));
        assert.ok(Result.isFailure(yield* api.snapshot));
        yield* TestClock.adjust('30 seconds');
        yield* Ref.set(
          test.current,
          Result.succeed({ phase: 'active', callId: 'external', startedAt: 0 }),
        );
        yield* TestClock.adjust('1 second');
        assert.strictEqual((yield* api.view).elapsedSeconds, 31);
        yield* Ref.set(test.current, Result.succeed(idle));
        yield* TestClock.adjust('1 second');
        assert.strictEqual((yield* api.view).phase, 'idle');
        assert.strictEqual((yield* api.view).elapsedSeconds, 0);
        assert.strictEqual(test.calls(), 0);
        assert.deepStrictEqual(test.stopped, []);
      }),
    ),
);

it.effect('hangup targets the current ID and never claims a different call has ended', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const test = yield* fixture;
      yield* Ref.set(
        test.current,
        Result.succeed({ phase: 'active', callId: 'first', startedAt: 0 }),
      );
      const targeted: string[] = [];
      const second: Status = { phase: 'active', callId: 'second', startedAt: 0 };
      const api = yield* make.pipe(
        Effect.provideService(DotCallBackend, {
          ...test.backend,
          hangup: (id) =>
            Effect.sync(() => targeted.push(id)).pipe(
              Effect.andThen(Ref.set(test.current, Result.succeed(second))),
              Effect.as(second),
            ),
        }),
      );
      assert.ok(Result.isFailure(yield* Effect.result(api.hangup)));
      assert.deepStrictEqual(targeted, ['first']);
      assert.strictEqual((yield* api.state).callId, 'second');
    }),
  ),
);

it.effect(
  'closing the monitor revokes control and polling, preserving the application-owned call',
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      yield* Ref.set(
        test.current,
        Result.succeed({ phase: 'active', callId: 'external', startedAt: 0 }),
      );
      const api = yield* Effect.scoped(
        make.pipe(Effect.provideService(DotCallBackend, test.backend)),
      );
      const reads = test.reads();
      yield* TestClock.adjust('3 seconds');
      assert.strictEqual(test.reads(), reads);
      assert.ok(Result.isFailure(yield* Effect.result(api.toggle)));
      assert.deepStrictEqual(test.stopped, []);
    }),
);

it.live(
  'an unconfigured dot backend is available as typed offline state and never invokes audio',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const services = yield* Layer.build(DotCallBackend.layer);
        const backend = Context.get(services, DotCallBackend);
        assert.ok(Result.isFailure(yield* Effect.result(backend.read)));
        assert.ok(Result.isFailure(yield* Effect.result(backend.call)));
      }),
    ).pipe(
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnvRecord({})),
      Effect.provide(NodeServices.layer),
    ),
);

it.live(
  'the optional command adapter reads actual JSON and sends an exact call ID as a literal argument',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: 'dot-call-test-' });
        const script = `${root}/bridge`;
        yield* fs.writeFileString(
          script,
          `#!/bin/sh
if [ "$1" = hangup ]; then printf '%s' "$2" > '${root}/id'; fi
printf '%s' '{"phase":"idle","callId":null,"startedAt":null}'
`,
          { mode: 0o700 },
        );
        const services = yield* Layer.build(DotCallBackend.layer).pipe(
          Effect.provideService(
            ConfigProvider.ConfigProvider,
            ConfigProvider.fromEnvRecord({
              STREAMDECK_DOT_CALL: JSON.stringify([script, 'call']),
              STREAMDECK_DOT_HANGUP: JSON.stringify([script, 'hangup']),
              STREAMDECK_DOT_STATUS: JSON.stringify([script, 'status']),
            }),
          ),
        );
        const backend = Context.get(services, DotCallBackend);
        assert.deepStrictEqual(yield* backend.read, idle);
        const id = 'call $(must-stay-literal)';
        yield* backend.hangup(id);
        assert.strictEqual(yield* fs.readFileString(`${root}/id`), id);
        yield* fs.writeFileString(
          script,
          '#!/bin/sh\nprintf \'%s\' \'{"phase":"active","callId":"call","startedAt":null}\'\n',
          { mode: 0o700 },
        );
        assert.ok(Result.isFailure(yield* Effect.result(backend.read)));
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);
