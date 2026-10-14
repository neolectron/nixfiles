import { assert, expect, it, test } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import { Deferred, Effect, Fiber, Ref, Stream } from 'effect';
import * as Bindings from '../src/bindings.ts';
import * as Image from '../src/image.ts';
import * as Mock from '../src/mock.ts';
import { StreamDeck, discover, type Device } from '../src/stream-deck.ts';
import { StreamDeckError } from '../src/errors.ts';
import type { DeckEvent } from '../src/model.ts';
import { startHello } from '../src/scripts/hello.ts';
import { cli } from './cli.ts';

const error = new StreamDeckError({ reason: 'Driver', operation: 'test', message: 'USB failure' });
const run = <A, E>(
  effect: Effect.Effect<A, E, StreamDeck>,
  mock: ReturnType<typeof Mock.make>,
  options = {},
) => Effect.runPromise(effect.pipe(Effect.provide(mock.layer(options))));
const failReason = async (promise: Promise<unknown>, reason: StreamDeckError['reason']) => {
  await expect(promise).rejects.toBeInstanceOf(StreamDeckError);
  await expect(promise).rejects.toMatchObject({ reason });
};

test('discovery does not open a handle; ambiguity and stale paths fail before opening', async () => {
  const mock = Mock.make({ devices: [Mock.plusXl, { ...Mock.plusXl, path: 'mock://other' }] });
  assert.strictEqual(
    (await Effect.runPromise(discover.pipe(Effect.provide(mock.driverLayer)))).length,
    2,
  );
  assert.strictEqual(mock.opens, 0);
  await failReason(run(Effect.void, mock), 'Ambiguous');
  await failReason(run(Effect.void, mock, { path: 'mock://missing' }), 'NotFound');
  assert.strictEqual(mock.opens, 0);
  await run(Effect.void, mock, { path: 'mock://other' });
  assert.strictEqual(mock.opens, 1);
  assert.strictEqual(mock.closes, 1);
  await failReason(run(Effect.void, Mock.make({ devices: [] })), 'NotFound');
});

test('scope closes exactly once after success, typed failure and interruption', async () => {
  const success = Mock.make();
  await run(Effect.void, success);
  assert.strictEqual(success.closes, 1);
  const failed = Mock.make();
  await expect(run(Effect.fail(error), failed)).rejects.toBeDefined();
  assert.strictEqual(failed.closes, 1);
  const interrupted = Mock.make();
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const ready = yield* Deferred.make<void>();
        const fiber = yield* Effect.forkScoped(
          Effect.gen(function* () {
            yield* StreamDeck;
            yield* Deferred.succeed(ready, undefined);
            yield* Effect.never;
          }).pipe(Effect.provide(interrupted.layer())),
        );
        yield* Deferred.await(ready);
        yield* Fiber.interrupt(fiber);
      }),
    ),
  );
  assert.strictEqual(interrupted.closes, 1);
});

test('event subscriptions broadcast independently instead of competing for a queue', async () => {
  const mock = Mock.make();
  const events: DeckEvent[] = [
    { _tag: 'KeyDown', key: 0 },
    { _tag: 'KeyUp', key: 0 },
  ];
  const result = await run(
    Effect.scoped(
      Effect.gen(function* () {
        const deck = yield* StreamDeck;
        const a = yield* deck.subscribe;
        const b = yield* deck.subscribe;
        for (const event of events) yield* mock.emit(event);
        return yield* Effect.all([
          Stream.runCollect(a.pipe(Stream.take(2))),
          Stream.runCollect(b.pipe(Stream.take(2))),
        ]);
      }),
    ),
    mock,
  );
  assert.deepStrictEqual(result, [events, events]);
  assert.strictEqual(mock.closes, 1);
});

test('early driver errors survive until a subscriber or write checks the device', async () => {
  const mock = Mock.make({ onOpen: (observer) => observer.error(error) });
  await failReason(
    run(
      Effect.flatMap(StreamDeck, (deck) => Stream.runHead(deck.events)),
      mock,
    ),
    'Driver',
  );
  assert.strictEqual(mock.closes, 1);
  assert.strictEqual(mock.writes.length, 0);
});

test('a full bounded event buffer fails explicitly instead of dropping a key release', async () => {
  const mock = Mock.make();
  await failReason(
    run(
      Effect.scoped(
        Effect.gen(function* () {
          const deck = yield* StreamDeck;
          yield* deck.subscribe;
          yield* mock.emit({ _tag: 'KeyDown', key: 0 });
          yield* mock.emit({ _tag: 'KeyUp', key: 0 });
          yield* deck.awaitFailure;
        }),
      ),
      mock,
      { eventCapacity: 1 },
    ),
    'Overflow',
  );
  assert.strictEqual(mock.closes, 1);
});

test('invalid controls, images, colors and regions fail before native writes and do not poison the device', async () => {
  const mock = Mock.make();
  await run(
    Effect.gen(function* () {
      const deck = yield* StreamDeck;
      const image = yield* Image.solid({ width: 5, height: 5 }, [1, 2, 3]);
      for (const operation of [
        deck.key(99).clear,
        deck.key(0).setImage(image),
        deck.key(0).fill([0, 256, 0]),
        deck.lcd(0).drawRegion({ x: 1199, y: 0 }, image),
        deck.setBrightness(-1),
        deck.setBrightness(10.5),
      ]) {
        const reason = yield* operation.pipe(
          Effect.match({ onFailure: (e) => e.reason, onSuccess: () => 'unexpected' }),
        );
        assert.strictEqual(reason, 'InvalidArgument');
      }
      assert.strictEqual(mock.writes.length, 0);
      yield* deck.key(0).fill([1, 2, 3]);
      yield* deck.lcd(0).drawRegion({ x: 1195, y: 95 }, image);
    }),
    mock,
  );
  assert.deepStrictEqual(
    mock.writes.map((write) => write.kind),
    ['key', 'region'],
  );
});

test('pedal inputs work without LCD feedback and image operations fail as unsupported', async () => {
  const mock = Mock.make({
    devices: [{ ...Mock.plusXl, controls: [{ type: 'button', index: 0, feedbackType: 'none' }] }],
  });
  await failReason(
    run(
      Effect.flatMap(StreamDeck, (deck) => deck.key(0).label('HELLO')),
      mock,
    ),
    'Unsupported',
  );
  assert.strictEqual(mock.writes.length, 0);
});

test('key, LCD, region, brightness and logo writes share one serial lane', async () => {
  let active = 0;
  let maxActive = 0;
  const mock = Mock.make({
    onWrite: () =>
      Effect.gen(function* () {
        yield* Effect.sync(() => {
          active++;
          maxActive = Math.max(maxActive, active);
        });
        yield* Effect.sleep(2);
        yield* Effect.sync(() => {
          active--;
        });
      }),
  });
  await run(
    Effect.gen(function* () {
      const deck = yield* StreamDeck;
      yield* Effect.all(
        [
          deck.key(0).label('HELLO'),
          deck.lcd(0).label('LEVEL 42'),
          deck.setBrightness(35),
          deck.resetToLogo,
        ],
        { concurrency: 'unbounded' },
      );
      assert.strictEqual(yield* deck.firmwareVersion, 'mock-fw');
      assert.strictEqual(yield* deck.serialNumber, 'mock-serial');
    }),
    mock,
  );
  assert.strictEqual(maxActive, 1);
  assert.strictEqual(mock.writes.length, 4);
});

test('interruption waits for an in-flight write before releasing its permit and closing', async () => {
  const order: string[] = [];
  const started = Deferred.makeUnsafe<void>();
  const mock = Mock.make({
    onWrite: () =>
      Effect.gen(function* () {
        order.push('start');
        yield* Deferred.succeed(started, undefined);
        yield* Effect.sleep(20);
        order.push('finish');
      }),
  });
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkScoped(
          Effect.flatMap(StreamDeck, (deck) => deck.key(0).clear).pipe(
            Effect.provide(mock.layer()),
          ),
        );
        yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
        order.push('interrupted');
      }),
    ),
  );
  assert.deepStrictEqual(order, ['start', 'finish', 'interrupted']);
  assert.strictEqual(mock.closes, 1);
});

test('queued images snapshot their pixels before the caller can mutate the buffer', async () => {
  const blocked = Deferred.makeUnsafe<void>();
  const release = Deferred.makeUnsafe<void>();
  let writes = 0;
  const mock = Mock.make({
    onWrite: () =>
      Effect.gen(function* () {
        if (++writes === 1) {
          yield* Deferred.succeed(blocked, undefined);
          yield* Deferred.await(release);
        }
      }),
  });
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const deck = yield* StreamDeck;
        const first = yield* Effect.forkScoped(deck.key(0).clear);
        yield* Deferred.await(blocked);
        const image = yield* Image.solid({ width: 112, height: 112 }, [7, 8, 9]);
        const second = yield* Effect.forkScoped(deck.key(1).setImage(image));
        yield* Effect.yieldNow;
        image.data.fill(0);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(first);
        yield* Fiber.join(second);
      }),
    ),
    mock,
  );
  const second = mock.writes[1]!;
  assert.ok(second.kind === 'key');
  assert.deepStrictEqual([...second.image.data.slice(0, 3)], [7, 8, 9]);
});

test('a write error fails later operations and streams; cleanup is preserved', async () => {
  const mock = Mock.make({ onWrite: () => Effect.fail(error) });
  await run(
    Effect.gen(function* () {
      const deck = yield* StreamDeck;
      assert.strictEqual(
        yield* deck
          .key(0)
          .clear.pipe(Effect.match({ onFailure: (e) => e.reason, onSuccess: () => 'unexpected' })),
        'Driver',
      );
      assert.strictEqual(
        yield* deck
          .lcd(0)
          .clear.pipe(Effect.match({ onFailure: (e) => e.reason, onSuccess: () => 'unexpected' })),
        'Driver',
      );
      assert.strictEqual(
        yield* Stream.runHead(deck.events).pipe(
          Effect.match({ onFailure: (e) => e.reason, onSuccess: () => 'unexpected' }),
        ),
        'Driver',
      );
    }),
    mock,
  );
  assert.strictEqual(mock.writes.length, 0);
  assert.strictEqual(mock.closes, 1);
});

test('an interrupted caller cannot hide an in-flight driver failure from later callers', async () => {
  const entered = Deferred.makeUnsafe<void>();
  let attempts = 0;
  const mock = Mock.make({
    onWrite: () =>
      Effect.gen(function* () {
        attempts++;
        yield* Deferred.succeed(entered, undefined);
        yield* Effect.sleep(20);
        return yield* Effect.fail(error);
      }),
  });
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const deck = yield* StreamDeck;
        const fiber = yield* Effect.forkScoped(deck.key(0).clear);
        yield* Deferred.await(entered);
        yield* Fiber.interrupt(fiber);
        const failure = yield* deck
          .lcd(0)
          .clear.pipe(Effect.match({ onFailure: (e) => e.reason, onSuccess: () => 'unexpected' }));
        assert.strictEqual(failure, 'Driver');
        assert.strictEqual(attempts, 1);
      }),
    ),
    mock,
  );
  assert.strictEqual(mock.closes, 1);
});

test('bindings route press/release, signed rotation and all touch gestures in order', async () => {
  const mock = Mock.make();
  const seen: string[] = [];
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const done = yield* Deferred.make<void>();
        const record = (value: string) =>
          Effect.sync(() => {
            seen.push(value);
          });
        const binding = yield* Bindings.start({
          buttons: { 0: { label: 'HI', onPress: record('press'), onRelease: record('release') } },
          knobs: {
            0: {
              onPress: record('dial press'),
              onRelease: record('dial release'),
              onRotate: ({ delta }) => record(`rotate ${delta}`),
            },
          },
          touch: {
            0: {
              onTap: record('tap'),
              onHold: record('hold'),
              onSwipe: record('swipe').pipe(Effect.andThen(Deferred.succeed(done, undefined))),
            },
          },
        });
        const fiber = yield* Effect.forkScoped(binding.run);
        for (const event of [
          ...Mock.demoEvents,
          { _tag: 'TouchHold', lcd: 0, position: { x: 1, y: 1 } },
          { _tag: 'TouchSwipe', lcd: 0, from: { x: 1, y: 1 }, to: { x: 100, y: 1 } },
        ] as DeckEvent[])
          yield* mock.emit(event);
        yield* Effect.raceFirst(Deferred.await(done), Fiber.join(fiber));
      }),
    ),
    mock,
  );
  assert.deepStrictEqual(seen, [
    'press',
    'release',
    'dial press',
    'dial release',
    'rotate 3',
    'rotate -2',
    'tap',
    'hold',
    'swipe',
  ]);
  assert.strictEqual(mock.writes.length, 1);
});

test('touch zones use half-open bounds and assign swipes by their starting position', async () => {
  const mock = Mock.make();
  const seen: string[] = [];
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const done = yield* Deferred.make<void>();
        const binding = yield* Bindings.start({
          touch: {
            0: [
              {
                area: { x: 0, y: 0, width: 600, height: 100 },
                onTap: Effect.sync(() => {
                  seen.push('left');
                }),
                onSwipe: Effect.sync(() => {
                  seen.push('left swipe');
                }).pipe(Effect.andThen(Deferred.succeed(done, undefined))),
              },
              {
                onTap: Effect.sync(() => {
                  seen.push('right');
                }),
              },
            ],
          },
        });
        const fiber = yield* Effect.forkScoped(binding.run);
        yield* mock.emit({ _tag: 'TouchTap', lcd: 0, position: { x: 599, y: 1 } });
        yield* mock.emit({ _tag: 'TouchTap', lcd: 0, position: { x: 600, y: 1 } });
        yield* mock.emit({
          _tag: 'TouchSwipe',
          lcd: 0,
          from: { x: 20, y: 1 },
          to: { x: 1000, y: 1 },
        });
        yield* Effect.raceFirst(Deferred.await(done), Fiber.join(fiber));
      }),
    ),
    mock,
  );
  assert.deepStrictEqual(seen, ['left', 'right', 'left swipe']);
});

test('a bad binding or failed handler fails the program and releases the handle', async () => {
  const bad = Mock.make();
  await failReason(
    run(Bindings.run({ knobs: { 9: { onRotate: Effect.void } } }), bad),
    'InvalidArgument',
  );
  assert.strictEqual(bad.writes.length, 0);
  assert.strictEqual(bad.closes, 1);
  const failed = Mock.make();
  await failReason(
    run(
      Effect.scoped(
        Effect.gen(function* () {
          const binding = yield* Bindings.start({
            buttons: { 0: { onPress: Effect.fail(error) } },
          });
          yield* failed.emit({ _tag: 'KeyDown', key: 0 });
          yield* binding.run;
        }),
      ),
      failed,
    ),
    'Driver',
  );
  assert.strictEqual(failed.closes, 1);
});

test('disconnect interrupts a running handler and releases its scoped resources', async () => {
  const mock = Mock.make();
  let released = 0;
  await failReason(
    run(
      Effect.scoped(
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>();
          const action = Effect.acquireRelease(Deferred.succeed(entered, undefined), () =>
            Effect.sync(() => {
              released++;
            }),
          ).pipe(Effect.andThen(Effect.never));
          const binding = yield* Bindings.start({ buttons: { 0: { onPress: action } } });
          const fiber = yield* Effect.forkScoped(binding.run);
          yield* mock.emit({ _tag: 'KeyDown', key: 0 });
          yield* Deferred.await(entered);
          yield* mock.disconnect();
          yield* Fiber.join(fiber);
        }),
      ),
      mock,
    ),
    'Driver',
  );
  assert.strictEqual(released, 1);
  assert.strictEqual(mock.closes, 1);
});

test('page changes repaint owned keys, preserve unowned keys, and route release to the original page', async () => {
  const mock = Mock.make();
  const seen: string[] = [];
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const pressed = yield* Deferred.make<void>();
        const released = yield* Deferred.make<void>();
        const pages = yield* Bindings.pages(
          {
            a: {
              buttons: {
                0: {
                  label: 'A',
                  onPress: Deferred.succeed(pressed, undefined),
                  onRelease: Effect.sync(() => {
                    seen.push('a release');
                  }).pipe(Effect.andThen(Deferred.succeed(released, undefined))),
                },
              },
            },
            b: {
              buttons: {
                1: { label: 'B' },
                0: {
                  onRelease: Effect.sync(() => {
                    seen.push('b release');
                  }),
                },
              },
            },
          },
          'a',
        );
        const fiber = yield* Effect.forkScoped(pages.run);
        yield* mock.emit({ _tag: 'KeyDown', key: 0 });
        yield* Deferred.await(pressed);
        yield* pages.select('b');
        assert.strictEqual(yield* pages.current, 'b');
        yield* mock.emit({ _tag: 'KeyUp', key: 0 });
        yield* Effect.raceFirst(Deferred.await(released), Fiber.join(fiber));
      }),
    ),
    mock,
  );
  assert.deepStrictEqual(seen, ['a release']);
  assert.ok(mock.writes.every((write) => write.kind === 'key' && write.index <= 1));
  const cleared = mock.writes.filter((write) => write.kind === 'key' && write.index === 0).at(-1)!;
  assert.ok(cleared.kind === 'key' && cleared.image.data.every((byte) => byte === 0));
});

test('hello draws only the first key, opt-in band, and clamps simulated dial state', async () => {
  const mock = Mock.make();
  const state = await run(
    Effect.scoped(
      Effect.gen(function* () {
        const done = yield* Deferred.make<void>();
        const hello = yield* startHello(true, (event) =>
          event._tag === 'TouchTap'
            ? Effect.asVoid(Deferred.succeed(done, undefined))
            : Effect.void,
        );
        const fiber = yield* Effect.forkScoped(hello.run);
        for (const event of [
          { _tag: 'KeyDown', key: 0 },
          { _tag: 'KeyUp', key: 0 },
          { _tag: 'DialRotate', dial: 0, delta: 1000 },
          { _tag: 'DialRotate', dial: 0, delta: -1000 },
          { _tag: 'TouchTap', lcd: 0, position: { x: 1, y: 1 } },
        ] as DeckEvent[])
          yield* mock.emit(event);
        yield* Effect.raceFirst(Deferred.await(done), Fiber.join(fiber));
        return yield* hello.state;
      }),
    ),
    mock,
  );
  assert.strictEqual(state.level, 0);
  assert.strictEqual(state.pressed, false);
  assert.strictEqual(mock.writes.length, 10);
  assert.ok(
    mock.writes.every(
      (write) => (write.kind === 'key' || write.kind === 'lcd') && write.index === 0,
    ),
  );
});

test('a service retained after its scope closes refuses further writes', async () => {
  const mock = Mock.make();
  const deck: Device = await run(StreamDeck, mock);
  await failReason(Effect.runPromise(deck.key(0).clear), 'Closed');
  assert.strictEqual(mock.writes.length, 0);
  await failReason(Effect.runPromise(Stream.runHead(deck.events)), 'Closed');
});

it.live('CLI mock hello/events run without native HID and preserve the finite demos', () =>
  Effect.gen(function* () {
    for (const args of [
      ['hello', '--mock', '--demo', '--lcd'],
      ['events', '--mock', '--demo'],
    ]) {
      const result = yield* cli(args);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.match(result.stdout, /"kind":"demo-complete"/);
      assert.match(result.stdout, /"events":7/);
      if (args[0] === 'hello') assert.match(result.stdout, /"frames":5,"lcdFrames":5,"level":51/);
      else assert.match(result.stdout, /"frames":0,"lcdFrames":0/);
    }
  }).pipe(Effect.provide(NodeServices.layer)),
);
it.live('CLI guards run before HID import and bounded listening finalizes', () =>
  Effect.gen(function* () {
    for (const args of [
      ['hello', '--demo'],
      ['events', '--lcd'],
      ['hello', '--duration', 'NaN'],
    ]) {
      const result = yield* cli(args);
      assert.strictEqual(result.status, 1, result.stderr);
      assert.notMatch(result.stderr, /libudev/);
    }
    const timed = yield* cli(['events', '--mock', '--duration', '0.02']);
    assert.strictEqual(timed.status, 0, timed.stderr);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.live(
  'Effect CLI generates help and validates unsupported flags and duration schemas before HID access',
  () =>
    Effect.gen(function* () {
      const help = yield* cli(['hello', '--help']);
      assert.strictEqual(help.status, 0, help.stderr);
      assert.match(help.stdout, /--lcd/);
      for (const args of [
        ['list', '--duration', '1'],
        ['hello', '--duration', '0'],
        ['hello', '--duration', '86401'],
        ['hello', '--unknown'],
      ]) {
        const invalid = yield* cli(args);
        assert.strictEqual(invalid.status, 1, invalid.stderr);
        assert.notMatch(invalid.stderr, /libudev|open HID/);
      }
    }).pipe(Effect.provide(NodeServices.layer)),
);
