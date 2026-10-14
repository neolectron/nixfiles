import { assert, it } from '@effect/vitest';
import { Deferred, Effect, Fiber, Ref, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import * as Bindings from '../src/bindings.ts';
import * as Plugin from '../src/plugin.ts';
import * as Mock from '../src/mock.ts';
import * as Host from '../src/plugin-host.ts';
import type { DeckEvent, DialRotate } from '../src/model.ts';

it.effect('buttons and knobs share semantic handlers; rotate and touch can reuse declared plugin actions', () => {
  const mock = Mock.make();
  return Effect.scoped(Effect.gen(function*() {
    const total = yield* Ref.make(0);
    const action = Plugin.action({ id: 'add', name: 'Add', description: '', input: Schema.Struct({ amount: Schema.Int }), defaults: { amount: 1 },
      run: (api: typeof total, input) => Ref.update(api, (n) => n + input.amount) });
    const add = (amount: number) => Plugin.handler(action, total, { amount });
    // The scripting adapter preserves encoded parameter types from the action Schema.
    // @ts-expect-error amount must be a number, even though host/catalogue inputs are unknown.
    Plugin.handler(action, total, { amount: 'invalid' });
    const bindings = yield* Bindings.start({ buttons: { 0: { onShortPress: add(1), onLongPress: add(10), onDoubleTap: add(100) } },
      knobs: { 0: { onShortPress: add(2), onLongPress: add(20), onDoubleTap: add(200), onRotate: Plugin.mapHandler(action, total, (event: DialRotate) => ({ amount: event.delta * 1000 })) } },
      touch: { 0: { onTap: add(10000), onHold: add(20000), onSwipe: add(30000) } } });
    yield* Effect.forkScoped(bindings.run);
    const emit = (event: DeckEvent) => mock.emit(event).pipe(Effect.andThen(TestClock.adjust(1)));
    yield* emit({ _tag: 'KeyDown', key: 0 }); yield* emit({ _tag: 'KeyUp', key: 0 }); yield* TestClock.adjust(350);
    assert.strictEqual(yield* Ref.get(total), 1);
    yield* emit({ _tag: 'DialDown', dial: 0 }); yield* TestClock.adjust(600); yield* emit({ _tag: 'DialUp', dial: 0 });
    assert.strictEqual(yield* Ref.get(total), 21);
    for (let i = 0; i < 2; i++) { yield* emit({ _tag: 'DialDown', dial: 0 }); yield* emit({ _tag: 'DialUp', dial: 0 }); }
    yield* TestClock.adjust(350); assert.strictEqual(yield* Ref.get(total), 221);
    yield* emit({ _tag: 'DialRotate', dial: 0, delta: 1 });
    yield* emit({ _tag: 'TouchTap', lcd: 0, position: { x: 1, y: 1 } });
    yield* emit({ _tag: 'TouchHold', lcd: 0, position: { x: 1, y: 1 } });
    yield* emit({ _tag: 'TouchSwipe', lcd: 0, from: { x: 1, y: 1 }, to: { x: 30, y: 1 } });
    assert.strictEqual(yield* Ref.get(total), 61221);
  })).pipe(Effect.provide(mock.layer()));
});

it.effect('a plugin hold action stays responsive and releases after page navigation; interrupting cancels its task', () => {
  const mock = Mock.make();
  return Effect.scoped(Effect.gen(function*() {
    const starts = yield* Ref.make(0); const stops = yield* Ref.make(0);
    const action = Plugin.action({ id: 'hold', name: 'Hold', description: '', input: Plugin.NoInput, defaults: {}, interaction: 'hold',
      run: (_api: undefined, _input, context) => Effect.gen(function*() {
        yield* Effect.addFinalizer(() => Ref.update(stops, (n) => n + 1));
        yield* Ref.update(starts, (n) => n + 1); yield* context.released!;
      }) });
    const pages = yield* Bindings.pages({ home: { buttons: { 0: { onLongPress: Plugin.handler(action, undefined), longPressMs: 100 } } }, tools: {} }, 'home');
    const runner = yield* Effect.forkScoped(pages.run);
    yield* mock.emit({ _tag: 'KeyDown', key: 0 }); yield* TestClock.adjust(100); assert.strictEqual(yield* Ref.get(starts), 1);
    yield* pages.select('tools'); yield* mock.emit({ _tag: 'KeyUp', key: 0 }); yield* TestClock.adjust(1);
    assert.strictEqual(yield* Ref.get(stops), 1);
    yield* pages.select('home'); yield* mock.emit({ _tag: 'KeyDown', key: 0 }); yield* TestClock.adjust(100);
    assert.strictEqual(yield* Ref.get(starts), 2); yield* Fiber.interrupt(runner); assert.strictEqual(yield* Ref.get(stops), 2);
  })).pipe(Effect.provide(mock.layer()));
});

it.effect('host disable cancels plugin bindings and their held actions, then re-enable starts fresh', () => {
  const mock = Mock.make();
  return Effect.scoped(Effect.gen(function*() {
    const starts = yield* Ref.make(0); const stops = yield* Ref.make(0);
    const action = Plugin.action({ id: 'hold', name: 'Hold', description: '', input: Plugin.NoInput, defaults: {}, interaction: 'hold',
      run: (_api: undefined, _input, context) => Ref.update(starts, (n) => n + 1).pipe(Effect.andThen(context.released!),
        Effect.ensuring(Ref.update(stops, (n) => n + 1))) });
    const host = yield* Host.make;
    const handle = yield* host.install(Plugin.define({ id: 'gestures', name: 'Gestures', description: '', controls: { keys: [0] }, actions: [action],
      setup: Effect.gen(function*() {
        const binding = yield* Bindings.start({ buttons: { 0: { onPress: Plugin.handler(action, undefined) } } });
        return { api: undefined, run: binding.run };
      }) }));
    yield* host.setEnabled(handle.id, true);
    yield* mock.emit({ _tag: 'KeyDown', key: 0 }); yield* TestClock.adjust(1); assert.strictEqual(yield* Ref.get(starts), 1);
    yield* host.setEnabled(handle.id, false); assert.strictEqual(yield* Ref.get(stops), 1);
    yield* mock.emit({ _tag: 'KeyUp', key: 0 });
    yield* host.setEnabled(handle.id, true);
    yield* mock.emit({ _tag: 'KeyDown', key: 0 }); yield* TestClock.adjust(1); assert.strictEqual(yield* Ref.get(starts), 2);
    yield* mock.emit({ _tag: 'KeyUp', key: 0 }); yield* TestClock.adjust(1); assert.strictEqual(yield* Ref.get(stops), 2);
  })).pipe(Effect.provide(mock.layer()));
});

it.effect('background failures fail the input owner and clean up other actions', () => {
  const mock = Mock.make();
  return Effect.scoped(Effect.gen(function*() {
    const stopped = yield* Ref.make(false); const ready = yield* Deferred.make<void>();
    const bindings = yield* Bindings.start({ buttons: {
      0: { onPress: Bindings.background(Effect.acquireRelease(Deferred.succeed(ready, undefined), () => Ref.set(stopped, true)).pipe(Effect.andThen(Effect.never))) },
      1: { onPress: Bindings.background(Effect.fail('background failed')) },
    } });
    const runner = yield* Effect.forkScoped(bindings.run);
    yield* mock.emit({ _tag: 'KeyDown', key: 0 }); yield* Deferred.await(ready);
    yield* mock.emit({ _tag: 'KeyDown', key: 1 });
    const result = yield* Effect.result(Fiber.join(runner)); assert.strictEqual(result._tag, 'Failure');
    if (result._tag === 'Failure') assert.strictEqual(result.failure, 'background failed');
    assert.strictEqual(yield* Ref.get(stopped), true);
  })).pipe(Effect.provide(mock.layer()));
});

it.effect('binding validation rejects conflicting gestures and invalid knob thresholds before rendering', () => {
  const mock = Mock.make();
  return Effect.scoped(Effect.gen(function*() {
    for (const profile of [
      { knobs: { 0: { onLongPress: Effect.void, longPressMs: 99 } } },
      { buttons: { 0: { trigger: { type: 'press' as const }, onDoubleTap: Effect.void } } },
    ]) assert.strictEqual((yield* Effect.result(Bindings.start(profile)))._tag, 'Failure');
    assert.strictEqual(mock.writes.length, 0);
  })).pipe(Effect.provide(mock.layer()));
});

it.effect('a completed double tap cannot accidentally start a declared hold action', () => {
  const mock = Mock.make();
  return Effect.scoped(Effect.gen(function*() {
    const starts = yield* Ref.make(0);
    const action = Plugin.action({ id: 'hold', name: 'Hold', description: '', input: Plugin.NoInput, defaults: {}, interaction: 'hold',
      run: (_api: undefined) => Ref.update(starts, (n) => n + 1) });
    const binding = yield* Bindings.start({ buttons: { 0: { onDoubleTap: Plugin.handler(action, undefined) } } });
    const runner = yield* Effect.forkScoped(binding.run);
    for (let i = 0; i < 2; i++) {
      yield* mock.emit({ _tag: 'KeyDown', key: 0 }); yield* mock.emit({ _tag: 'KeyUp', key: 0 }); yield* TestClock.adjust(1);
    }
    const result = yield* Effect.result(Fiber.join(runner)); assert.strictEqual(result._tag, 'Failure');
    assert.strictEqual(yield* Ref.get(starts), 0);
  })).pipe(Effect.provide(mock.layer()));
});
