import { assert, it } from '@effect/vitest';
import { Deferred, Effect, Fiber, Ref, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import * as Gestures from '../src/press-gestures.ts';
import { KeyTrigger } from '../src/press-trigger.ts';
import * as Bindings from '../src/bindings.ts';
import * as Mock from '../src/mock.ts';

it.effect(
  'long press is canceled before its threshold, fires once at the threshold and ignores repeated down events',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const count = yield* Ref.make(0);
        const gestures = yield* Gestures.make<never, never>();
        const options = {
          identity: 'a',
          trigger: { type: 'long-press' as const },
          fire: Ref.update(count, (n) => n + 1),
        };
        yield* gestures.down('0', options);
        yield* TestClock.adjust(599);
        assert.strictEqual(yield* Ref.get(count), 0);
        yield* gestures.up('0');
        yield* TestClock.adjust(1000);
        assert.strictEqual(yield* Ref.get(count), 0);
        yield* gestures.down('0', options);
        yield* gestures.down('0', options);
        yield* TestClock.adjust(600);
        assert.strictEqual(yield* Ref.get(count), 1);
        yield* TestClock.adjust(5000);
        yield* gestures.up('0');
        assert.strictEqual(yield* Ref.get(count), 1);
        yield* gestures.down('0', { identity: 'simple', fire: options.fire });
        yield* gestures.down('0', { identity: 'simple', fire: options.fire });
        assert.strictEqual(yield* Ref.get(count), 2);
        yield* gestures.up('0');
      }),
    ),
);

it.effect(
  'double tap requires two short complete presses, never fires a single tap, and consumes pairs',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const count = yield* Ref.make(0);
        const gestures = yield* Gestures.make<never, never>();
        const options = {
          identity: 'a',
          trigger: { type: 'double-tap' as const },
          fire: Ref.update(count, (n) => n + 1),
        };
        const tap = gestures.down('0', options).pipe(Effect.andThen(gestures.up('0')));
        yield* tap;
        assert.strictEqual(yield* Ref.get(count), 0);
        yield* TestClock.adjust(350);
        yield* tap;
        assert.strictEqual(yield* Ref.get(count), 1);
        yield* tap;
        yield* TestClock.adjust(351);
        yield* tap;
        assert.strictEqual(yield* Ref.get(count), 1);
        yield* gestures.down('0', options);
        yield* TestClock.adjust(351);
        yield* gestures.up('0');
        assert.strictEqual(yield* Ref.get(count), 1);
        yield* tap;
        yield* tap;
        yield* tap;
        assert.strictEqual(yield* Ref.get(count), 2);
      }),
    ),
);

it.effect(
  'gesture identity and cancellation keep keys, sources and stale cleanup independent',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const count = yield* Ref.make(0);
        const gestures = yield* Gestures.make<never, never>();
        const options = {
          identity: 'a',
          context: 'old',
          trigger: { type: 'double-tap' as const },
          fire: Ref.update(count, (n) => n + 1),
        };
        yield* gestures.down('physical/0', options);
        yield* gestures.up('physical/0');
        yield* gestures.down('web/0', options);
        yield* gestures.up('web/0');
        assert.strictEqual(yield* Ref.get(count), 0);
        yield* gestures.cancel('physical/0');
        yield* gestures.down('physical/0', options);
        yield* gestures.up('physical/0');
        assert.strictEqual(yield* Ref.get(count), 0);
        const next = { ...options, identity: 'b', context: 'new' };
        yield* gestures.down('physical/0', next);
        yield* gestures.up('physical/0', 'old');
        yield* gestures.up('physical/0', 'new');
        yield* gestures.cancel('physical/0', 'old');
        yield* gestures.down('physical/0', next);
        yield* gestures.up('physical/0', 'new');
        assert.strictEqual(yield* Ref.get(count), 1);
      }),
    ),
);

it.effect('scope shutdown cancels pending timers and timer failures reach the observer', () =>
  Effect.gen(function* () {
    const count = yield* Ref.make(0);
    yield* Effect.scoped(
      Effect.gen(function* () {
        const gestures = yield* Gestures.make<never, never>();
        yield* gestures.down('0', {
          identity: 'a',
          trigger: { type: 'long-press' },
          fire: Ref.update(count, (n) => n + 1),
        });
      }),
    );
    yield* TestClock.adjust(1000);
    assert.strictEqual(yield* Ref.get(count), 0);
    yield* Effect.scoped(
      Effect.gen(function* () {
        const gestures = yield* Gestures.make<string, never>();
        yield* gestures.down('0', {
          identity: 'a',
          trigger: { type: 'long-press', milliseconds: 100 },
          fire: Effect.fail('failed action'),
        });
        yield* TestClock.adjust(100);
        const failure = yield* Effect.result(gestures.failure);
        assert.strictEqual(failure._tag, 'Failure');
        if (failure._tag === 'Failure') assert.strictEqual(failure.failure, 'failed action');
      }),
    );
  }),
);

it.effect(
  'script page navigation and interrupted routers cancel pending gestures, including away-and-back',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const mock = Mock.make();
        const count = yield* Ref.make(0);
        const down = yield* Deferred.make<void>();
        yield* Effect.gen(function* () {
          const pages = yield* Bindings.pages(
            {
              a: {
                onEvent: () => Deferred.succeed(down, undefined),
                buttons: {
                  0: {
                    trigger: { type: 'long-press', milliseconds: 100 },
                    onPress: Ref.update(count, (n) => n + 1),
                  },
                },
              },
              b: {},
            },
            'a',
          );
          const router = yield* Effect.forkScoped(pages.run);
          yield* mock.emit({ _tag: 'KeyDown', key: 0 });
          yield* Deferred.await(down);
          yield* pages.select('b');
          yield* pages.select('a');
          yield* TestClock.adjust(100);
          assert.strictEqual(yield* Ref.get(count), 0);
          yield* Fiber.interrupt(router);
          yield* TestClock.adjust(1000);
          assert.strictEqual(yield* Ref.get(count), 0);
        }).pipe(Effect.provide(mock.layer()));
      }),
    ),
);

it('gesture schemas reject unsupported modes and invalid intervals', () => {
  const decode = Schema.decodeUnknownSync(KeyTrigger);
  for (const value of [
    { type: 'long-press', milliseconds: 99 },
    { type: 'double-tap', milliseconds: 1001 },
    { type: 'double-tap', milliseconds: 200.5 },
    { type: 'triple-tap' },
  ])
    assert.throws(() => decode(value));
  assert.deepStrictEqual(decode({ type: 'double-tap' }), { type: 'double-tap' });
});

it.effect('short, long and double handlers arbitrate each gesture without duplicate actions', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const calls = yield* Ref.make<string[]>([]);
      const gestures = yield* Gestures.make<never, never>();
      const record = (name: string) => Ref.update(calls, (all) => [...all, name]);
      const options = {
        identity: 'a',
        handlers: {
          onShortPress: record('short'),
          onLongPress: record('long'),
          onDoubleTap: record('double'),
        },
      };
      const tap = gestures.down('custom/0', options).pipe(Effect.andThen(gestures.up('custom/0')));
      yield* tap;
      yield* TestClock.adjust(349);
      assert.deepStrictEqual(yield* Ref.get(calls), []);
      yield* TestClock.adjust(1);
      assert.deepStrictEqual(yield* Ref.get(calls), ['short']);
      yield* tap;
      yield* TestClock.adjust(100);
      yield* tap;
      yield* TestClock.adjust(600);
      assert.deepStrictEqual(yield* Ref.get(calls), ['short', 'double']);
      yield* gestures.down('custom/0', options);
      yield* TestClock.adjust(600);
      yield* gestures.up('custom/0');
      yield* TestClock.adjust(500);
      assert.deepStrictEqual(yield* Ref.get(calls), ['short', 'double', 'long']);
      // A second tap held past the long threshold consumes the first pending tap.
      yield* tap;
      yield* gestures.down('custom/0', options);
      yield* TestClock.adjust(600);
      yield* gestures.up('custom/0');
      yield* TestClock.adjust(500);
      assert.deepStrictEqual(yield* Ref.get(calls), ['short', 'double', 'long', 'long']);
    }),
  ),
);

it.effect(
  'a short-only handler fires on release and every gesture receives its original release signal',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const calls = yield* Ref.make<string[]>([]);
        const gestures = yield* Gestures.make<never, never>();
        const released = yield* Deferred.make<Effect.Effect<void>>();
        yield* gestures.down('0', {
          identity: 'a',
          handlers: {
            onPress: (context) => Deferred.succeed(released, context.released),
            onShortPress: (context) =>
              context.released.pipe(
                Effect.andThen(Ref.update(calls, (all) => [...all, context.gesture])),
              ),
          },
        });
        assert.deepStrictEqual(yield* Ref.get(calls), []);
        const wait = yield* Deferred.await(released);
        const waiter = yield* Effect.forkScoped(wait);
        yield* gestures.up('0');
        yield* Fiber.join(waiter);
        assert.deepStrictEqual(yield* Ref.get(calls), ['short-press']);
        const canceled = yield* Deferred.make<Effect.Effect<void>>();
        yield* gestures.down('0', {
          identity: 'a',
          handlers: { onPress: (context) => Deferred.succeed(canceled, context.released) },
        });
        yield* gestures.cancel('0');
        yield* yield* Deferred.await(canceled);
      }),
    ),
);

it.effect('cancel and stale identities suppress pending short taps as well as long timers', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const count = yield* Ref.make(0);
      const active = yield* Ref.make(true);
      const gestures = yield* Gestures.make<never, never>();
      const options = {
        identity: 'a',
        context: 'a',
        active: Ref.get(active),
        handlers: { onShortPress: Ref.update(count, (n) => n + 1), onDoubleTap: Effect.void },
      };
      yield* gestures.down('0', options);
      yield* gestures.up('0');
      yield* gestures.cancel('0', 'a');
      yield* TestClock.adjust(350);
      assert.strictEqual(yield* Ref.get(count), 0);
      yield* gestures.down('0', options);
      yield* gestures.up('0');
      yield* Ref.set(active, false);
      yield* TestClock.adjust(350);
      assert.strictEqual(yield* Ref.get(count), 0);
    }),
  ),
);
