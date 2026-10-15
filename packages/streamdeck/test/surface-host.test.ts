import { assert, it } from '@effect/vitest';
import { Deferred, Effect, Fiber, Ref, Result } from 'effect';
import { make, type Scene } from '../src/surface-host.ts';
import * as Image from '../src/image.ts';
import type { StreamDeckError } from '../src/errors.ts';
import * as Tiles from '../src/tile-instance.ts';

it.effect('one scoped scene arbitrates key and LCD ownership, touch routing and restoration', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const host = yield* make([0, 1], [{ index: 0, width: 1200, height: 100 }]);
      const hits = yield* Ref.make('');
      const scene = (name: string, priority: number): Scene<StreamDeckError> => ({
        name,
        priority,
        keys: { name, keys: { '0': { label: name, action: 'counter', parameters: { start: 0 } } } },
        lcd: [
          {
            lcd: 0,
            region: { x: 0, y: 0, width: 1200, height: 100 },
            frame: {
              stamp: name,
              view: { type: 'test', data: {} },
              draw: Image.solid({ width: 1200, height: 100 }, [0, 0, 0]),
            },
            onTouch: () => Ref.set(hits, name),
          },
        ],
      });
      const low = yield* host.open('low', scene('Low', 0));
      const high = yield* host.open('high', scene('High', 10));
      assert.strictEqual((yield* host.keys.snapshot).keys.get(0)?.entry?.binding.label, 'High');
      yield* host.touch({ lcd: 0, kind: 'tap', x: 20, y: 20 });
      assert.strictEqual(yield* Ref.get(hits), 'High');
      yield* high.close;
      yield* host.touch({ lcd: 0, kind: 'tap', x: 20, y: 20 });
      assert.strictEqual(yield* Ref.get(hits), 'Low');
      yield* low.close;
      assert.strictEqual((yield* host.keys.snapshot).keys.size, 0);
      assert.strictEqual(yield* host.covered(0, 20, 20), false);
      assert.ok(Result.isFailure(yield* Effect.result(high.update(scene('Late', 100)))));
    }),
  ),
);

it.effect('closing a presentation cancels delayed rendering and cleans up its resources', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const host = yield* make([], [{ index: 0, width: 200, height: 100 }]);
      const started = yield* Deferred.make<void>();
      const cleaned = yield* Deferred.make<void>();
      const presentation = yield* host.open('slow', {
        name: 'Slow',
        lcd: [
          {
            lcd: 0,
            region: { x: 0, y: 0, width: 200, height: 100 },
            frame: {
              stamp: 'slow',
              view: { type: 'test', data: {} },
              draw: Effect.acquireUseRelease(
                Deferred.succeed(started, undefined),
                () => Effect.never,
                () => Deferred.succeed(cleaned, undefined),
              ),
            },
          },
        ],
      });
      const frame = (yield* host.snapshot).entries[0]!.lcd[0]!.frame;
      const fiber = yield* Effect.forkScoped(frame.draw);
      yield* Deferred.await(started);
      yield* presentation.close;
      yield* Deferred.await(cleaned);
      assert.strictEqual((yield* Fiber.await(fiber))._tag, 'Failure');
    }),
  ),
);

it('tile adapters preserve action identity, gestures and state independently of placement', () => {
  const entry = {
    id: 'one',
    binding: {
      label: 'A',
      action: 'plugin' as const,
      parameters: { plugin: 'spotify', command: 'play', input: {} },
    },
    gestures: {
      doubleTap: {
        label: 'Stop',
        action: 'plugin' as const,
        parameters: { plugin: 'spotify', command: 'stop', input: {} },
      },
    },
    stateVersion: 'epoch',
  };
  assert.deepStrictEqual(Tiles.toKey(Tiles.fromKey(entry)), entry);
  const lcd = Tiles.toLcd(Tiles.fromKey(entry), 200);
  assert.deepStrictEqual(Tiles.fromLcd(lcd).action, Tiles.fromKey(entry).action);
});

it.effect(
  'a scoped knob claim restores the lower owner and a touch may update its own presentation',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const host = yield* make([], [{ index: 0, width: 200, height: 100 }], [0]);
        const turns = yield* Ref.make(0);
        const low = yield* host.open('low', {
          name: 'Low',
          knobs: [
            {
              dial: 0,
              onInput: (event) =>
                event._tag === 'DialRotate'
                  ? Ref.update(turns, (n) => n + event.delta)
                  : Effect.void,
            },
          ],
        });
        const high = yield* host.open('high');
        yield* high.update({
          name: 'High',
          priority: 1,
          knobs: [{ dial: 0, onInput: () => Ref.set(turns, 100) }],
          lcd: [
            {
              lcd: 0,
              region: { x: 0, y: 0, width: 200, height: 100 },
              frame: {
                stamp: '',
                view: { type: 'test', data: {} },
                draw: Effect.succeed({ width: 200, height: 100, data: new Uint8Array(60000) }),
              },
              onTouch: () => high.update(null),
            },
          ],
        });
        yield* host.knob({ _tag: 'DialRotate', dial: 0, delta: 1 });
        assert.strictEqual(yield* Ref.get(turns), 100);
        yield* host.touch({ lcd: 0, kind: 'tap', x: 1, y: 1 });
        yield* host.knob({ _tag: 'DialRotate', dial: 0, delta: 2 });
        assert.strictEqual(yield* Ref.get(turns), 102);
        yield* low.close;
        assert.strictEqual(yield* host.knobCovered(0), false);
      }),
    ).pipe(Effect.timeout('2 seconds')),
);

it.effect('a scene can close itself from its touch callback without deadlock or stale claims', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const host = yield* make([], [{ index: 0, width: 1, height: 1 }]);
      const handle = yield* host.open('self');
      yield* handle.update({
        name: 'Self',
        lcd: [
          {
            lcd: 0,
            region: { x: 0, y: 0, width: 1, height: 1 },
            frame: {
              stamp: '',
              view: { type: 'test', data: {} },
              draw: Effect.succeed({ width: 1, height: 1, data: new Uint8Array(3) }),
            },
            onTouch: () => handle.close,
          },
        ],
      });
      yield* host.touch({ lcd: 0, kind: 'tap', x: 0, y: 0 });
      assert.strictEqual((yield* host.snapshot).entries.length, 0);
      assert.ok(Result.isFailure(yield* Effect.result(handle.update({ name: 'Late' }))));
    }),
  ),
);
