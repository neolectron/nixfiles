import { assert, it } from '@effect/vitest';
import { Deferred, Effect, Fiber, Ref, Schema, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import * as Plugin from '../src/plugin.ts';

it.effect('declared actions consume arbitrary source events and drain finite background work', () => Effect.gen(function*() {
  const total = yield* Ref.make(0); const closed = yield* Ref.make(0);
  const action = Plugin.action({ id: 'add', name: 'Add', description: '', input: Schema.Struct({ amount: Schema.Int }), defaults: { amount: 1 },
    run: (api: typeof total, input) => Effect.gen(function*() {
      yield* Effect.addFinalizer(() => Ref.update(closed, (n) => n + 1));
      yield* Effect.sleep(100); yield* Ref.update(api, (n) => n + input.amount);
    }) });
  const program = Plugin.listen(Stream.fromArray([{ value: 2 }, { value: 3 }]), Plugin.mapHandler(action, total, (event: { value: number }) => ({ amount: event.value })));
  const fiber = yield* Effect.forkChild(program); yield* TestClock.adjust(100); yield* Fiber.join(fiber);
  assert.strictEqual(yield* Ref.get(total), 5); assert.strictEqual(yield* Ref.get(closed), 2);
  const staticSource = Plugin.listen(Stream.fromArray(['one', 'two']), Plugin.handler(action, total));
  const next = yield* Effect.forkChild(staticSource); yield* TestClock.adjust(100); yield* Fiber.join(next);
  assert.strictEqual(yield* Ref.get(total), 7); assert.strictEqual(yield* Ref.get(closed), 4);
}));

it.effect('source failure cancels in-flight actions and closes their resources', () => Effect.gen(function*() {
  const started = yield* Deferred.make<void>(); const fail = yield* Deferred.make<void>(); const stopped = yield* Ref.make(false);
  const action = Plugin.action({ id: 'wait', name: 'Wait', description: '', input: Plugin.NoInput, defaults: {},
    run: (_api: undefined) => Effect.gen(function*() {
      yield* Effect.addFinalizer(() => Ref.set(stopped, true)); yield* Deferred.succeed(started, undefined); yield* Effect.never;
    }) });
  const source = Stream.concat(Stream.succeed('start'), Stream.fromEffect(Deferred.await(fail)).pipe(Stream.flatMap(() => Stream.fail('source failed'))));
  const fiber = yield* Effect.forkChild(Plugin.listen(source, Plugin.handler(action, undefined)));
  yield* Deferred.await(started); yield* Deferred.succeed(fail, undefined);
  const result = yield* Effect.result(Fiber.join(fiber)); assert.strictEqual(result._tag, 'Failure');
  if (result._tag === 'Failure') assert.strictEqual(result.failure, 'source failed');
  assert.strictEqual(yield* Ref.get(stopped), true);
}));

it.effect('background action errors propagate even if the task finished before its source', () => Effect.gen(function*() {
  const failed = yield* Deferred.make<void>(); const done = yield* Deferred.make<void>();
  const action = Plugin.action({ id: 'fail', name: 'Fail', description: '', input: Plugin.NoInput, defaults: {},
    run: (_api: undefined) => Deferred.succeed(failed, undefined).pipe(Effect.andThen(Effect.fail('action failed'))) });
  const source = Stream.concat(Stream.succeed('start'), Stream.fromEffect(Deferred.await(done)).pipe(Stream.filter(() => false)));
  const fiber = yield* Effect.forkChild(Plugin.listen(source, Plugin.handler(action, undefined)));
  yield* Deferred.await(failed); yield* Deferred.succeed(done, undefined);
  const result = yield* Effect.result(Fiber.join(fiber)); assert.strictEqual(result._tag, 'Failure');
  if (result._tag === 'Failure') assert.strictEqual(result.failure, 'action failed');
}));
