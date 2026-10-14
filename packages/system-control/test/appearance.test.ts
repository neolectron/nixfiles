import { assert, it } from '@effect/vitest';
import { Effect, Ref, Result } from 'effect';
import { TestClock } from 'effect/testing';
import { AppearanceBackend, decodePreference, make, type Appearance } from '../src/appearance.ts';
import { IntegrationError } from '../src/errors.ts';

const fixture = Effect.gen(function* () {
  const current = yield* Ref.make<Result.Result<Appearance, IntegrationError>>(
    Result.succeed(decodePreference('prefer-light')),
  );
  const writes: string[] = [];
  let reads = 0;
  const backend = {
    read: Effect.sync(() => reads++).pipe(
      Effect.andThen(Ref.get(current)),
      Effect.flatMap(Effect.fromResult),
    ),
    set: (mode: 'dark' | 'light') =>
      Effect.sync(() => writes.push(mode)).pipe(
        Effect.andThen(Ref.set(current, Result.succeed(decodePreference(`prefer-${mode}`)))),
      ),
  };
  return { current, writes, backend, reads: () => reads };
});

it('appearance decodes the desktop preference and rejects unknown values', () => {
  assert.deepStrictEqual(decodePreference("'prefer-dark'\n"), {
    mode: 'dark',
    preference: 'prefer-dark',
  });
  assert.deepStrictEqual(decodePreference('prefer-light'), {
    mode: 'light',
    preference: 'prefer-light',
  });
  assert.deepStrictEqual(decodePreference("'default'"), { mode: 'light', preference: 'default' });
  assert.throws(() => decodePreference('unexpected'), IntegrationError);
});

it.effect(
  'appearance initializes read-only and serializes rapid toggles against fresh desktop state',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const test = yield* fixture;
        const api = yield* make.pipe(Effect.provideService(AppearanceBackend, test.backend));
        assert.deepStrictEqual(test.writes, []);
        yield* Ref.set(test.current, Result.succeed(decodePreference('prefer-dark')));
        yield* Effect.all([api.toggle, api.toggle], { concurrency: 'unbounded' });
        assert.deepStrictEqual(test.writes, ['light', 'dark']);
        assert.strictEqual((yield* api.state).mode, 'dark');
        yield* api.set('light');
        assert.strictEqual((yield* api.state).mode, 'light');
      }),
    ),
);

it.effect(
  'appearance follows external changes, exposes disconnection and recovers without writes',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const test = yield* fixture;
        const api = yield* make.pipe(Effect.provideService(AppearanceBackend, test.backend));
        yield* Ref.set(test.current, Result.succeed(decodePreference('prefer-dark')));
        yield* TestClock.adjust('1 second');
        assert.strictEqual((yield* api.state).mode, 'dark');
        yield* Ref.set(
          test.current,
          Result.fail(new IntegrationError({ message: 'Desktop offline' })),
        );
        yield* TestClock.adjust('1 second');
        assert.ok(Result.isFailure(yield* api.snapshot));
        assert.ok(Result.isFailure(yield* Effect.result(api.toggle)));
        yield* Ref.set(test.current, Result.succeed(decodePreference('prefer-light')));
        yield* TestClock.adjust('1 second');
        assert.strictEqual((yield* api.state).mode, 'light');
        assert.deepStrictEqual(test.writes, []);
      }),
    ),
);

it.effect(
  'appearance can acquire offline, stops polling on close and revokes retained commands',
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      yield* Ref.set(test.current, Result.fail(new IntegrationError({ message: 'Unavailable' })));
      const api = yield* Effect.scoped(
        make.pipe(Effect.provideService(AppearanceBackend, test.backend)),
      );
      const count = test.reads();
      yield* TestClock.adjust('3 seconds');
      assert.strictEqual(test.reads(), count);
      assert.ok(Result.isFailure(yield* Effect.result(api.toggle)));
      assert.ok(Result.isFailure(yield* Effect.result(api.set('dark'))));
      assert.deepStrictEqual(test.writes, []);
    }),
);

it.effect(
  'appearance refuses invalid modes, failed writes and a desktop that did not apply the change',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const test = yield* fixture;
        const api = yield* make.pipe(Effect.provideService(AppearanceBackend, test.backend));
        assert.ok(Result.isFailure(yield* Effect.result(api.set('invalid' as 'dark'))));
        assert.deepStrictEqual(test.writes, []);
        const failing = yield* make.pipe(
          Effect.provideService(AppearanceBackend, {
            ...test.backend,
            set: () => Effect.fail(new IntegrationError({ message: 'Write denied' })),
          }),
        );
        assert.ok(Result.isFailure(yield* Effect.result(failing.toggle)));
        assert.strictEqual((yield* failing.state).mode, 'light');
        const ignored = yield* make.pipe(
          Effect.provideService(AppearanceBackend, {
            ...test.backend,
            set: () => Effect.void,
          }),
        );
        assert.ok(Result.isFailure(yield* Effect.result(ignored.set('dark'))));
        assert.strictEqual((yield* ignored.state).mode, 'light');
      }),
    ),
);
