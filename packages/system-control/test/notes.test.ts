import { assert, it } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Result } from 'effect';
import { make } from '../src/notes.ts';

it.live(
  'notes persist, serialize appends and reject stale saves without losing dictated text',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: 'notes-test-' });
        const notes = yield* make(`${root}/notes`);
        assert.strictEqual((yield* notes.read('ideas')).revision, 0);
        assert.strictEqual(yield* fs.exists(`${root}/notes`), false);
        const first = yield* notes.ensure('ideas', 'Mes idées');
        yield* notes.save({ ...first, body: 'Typed', expectedRevision: first.revision });
        yield* Effect.all([notes.append('ideas', 'Dictée A'), notes.append('ideas', 'Dictée B')], {
          concurrency: 'unbounded',
        });
        const current = yield* notes.read('ideas');
        assert.strictEqual(current.body, 'Typed\nDictée A\nDictée B');
        assert.strictEqual(current.revision, 4);
        const stale = yield* Effect.result(
          notes.save({ ...first, body: 'Old draft', expectedRevision: 1 }),
        );
        assert.ok(Result.isFailure(stale));
        if (Result.isFailure(stale)) assert.strictEqual(stale.failure.status, 409);
        const reloaded = yield* make(`${root}/notes`);
        assert.deepStrictEqual(yield* reloaded.read('ideas'), current);
        assert.deepStrictEqual(yield* notes.ensure('ideas', 'Different'), current);
        assert.deepStrictEqual(yield* notes.append('ideas', '  '), current);
        assert.deepStrictEqual(yield* fs.readDirectory(`${root}/notes`), ['ideas.json']);
        assert.strictEqual((yield* fs.stat(`${root}/notes/ideas.json`)).mode & 0o777, 0o600);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.live(
  'notes reject invalid IDs/content and revoke retained methods when their scope closes',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: 'notes-test-' });
        const notes = yield* Effect.scoped(
          Effect.gen(function* () {
            const api = yield* make(`${root}/notes`);
            for (const id of ['../escape', '/absolute', 'a/b', 'Upper', '']) {
              const result = yield* Effect.result(api.ensure(id, 'Bad'));
              assert.ok(Result.isFailure(result));
              if (Result.isFailure(result)) assert.strictEqual(result.failure.status, 400);
            }
            assert.ok(
              Result.isFailure(
                yield* Effect.result(
                  api.save({ id: 'ok', title: '', body: '', expectedRevision: 0 }),
                ),
              ),
            );
            yield* api.ensure('ok', 'Valid');
            assert.ok(Result.isFailure(yield* Effect.result(api.append('ok', 'x'.repeat(64001)))));
            assert.strictEqual((yield* api.read('ok')).body, '');
            return api;
          }),
        );
        const closed = yield* Effect.result(notes.read('ok'));
        assert.ok(Result.isFailure(closed));
        if (Result.isFailure(closed)) assert.strictEqual(closed.failure.status, 503);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);
