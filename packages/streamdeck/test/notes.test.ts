import { assert, it } from '@effect/vitest';
import { NodeHttpServer, NodeServices } from '@effect/platform-node';
import { Deferred, Effect, Fiber, FileSystem, Layer, Schedule } from 'effect';
import { TestClock } from 'effect/testing';
import { HttpClient, HttpClientRequest, HttpServer } from 'effect/http';
import * as Notes from '@nixfiles/system-control/notes.ts';
import * as Speech from '@nixfiles/system-control/speech.ts';
import * as Audio from '@nixfiles/system-control/audio.ts';
import * as Plugin from '../src/plugin.ts';
import * as Host from '../src/plugin-host.ts';
import * as NotePlugin from '../src/plugins/notes.ts';
import * as Mock from '../src/mock.ts';
import * as Draft from '../web/note-draft.ts';
import { startStudio, httpApp } from '../src/scripts/studio.ts';

it.effect(
  'tap/hold arbitration opens on a short release and captures only after the threshold',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        let taps = 0;
        let holds = 0;
        const tap = Effect.sync(() => {
          taps++;
        });
        const hold = (released: Effect.Effect<void>) =>
          Effect.sync(() => {
            holds++;
          }).pipe(Effect.andThen(released));
        const context = { output: () => Effect.void };
        // Direct invocations with no physical release must never activate a microphone.
        yield* Plugin.tapOrHold(context, tap, hold);
        assert.strictEqual(taps, 1);
        const release = yield* Deferred.make<void>();
        const short = yield* Effect.forkScoped(
          Plugin.tapOrHold({ ...context, released: Deferred.await(release) }, tap, hold),
        );
        yield* TestClock.adjust(100);
        assert.strictEqual(taps, 1);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(short);
        assert.strictEqual(taps, 2);
        assert.strictEqual(holds, 0);
        const releaseLong = yield* Deferred.make<void>();
        const long = yield* Effect.forkScoped(
          Plugin.tapOrHold({ ...context, released: Deferred.await(releaseLong) }, tap, hold),
        );
        yield* TestClock.adjust(600);
        assert.strictEqual(holds, 1);
        assert.strictEqual(taps, 2);
        yield* Deferred.succeed(releaseLong, undefined);
        yield* Fiber.join(long);
        yield* Plugin.tapOrHold(
          { ...context, gesture: 'long-press', released: Effect.void },
          tap,
          hold,
        );
        assert.strictEqual(holds, 2);
      }),
    ),
);

it.live(
  'the Notes plugin opens an existing note, appends dictation and cancels capture when disabled',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: 'notes-plugin-' });
        const notes = yield* Notes.make(root);
        const entered = yield* Deferred.make<void>();
        let captures = 0;
        let stopped = 0;
        const speech = yield* Speech.make.pipe(
          Effect.provideService(Speech.SpeechBackend, {
            capture: (released, transcribing) =>
              Effect.sync(() => {
                captures++;
              }).pipe(
                Effect.andThen(Deferred.succeed(entered, undefined)),
                Effect.andThen(released),
                Effect.andThen(transcribing),
                Effect.as('Texte dicté.'),
                Effect.ensuring(
                  Effect.sync(() => {
                    stopped++;
                  }),
                ),
              ),
          }),
        );
        const opened: string[] = [];
        yield* Effect.gen(function* () {
          const host = yield* Host.make;
          yield* host.install(NotePlugin.plugin);
          assert.strictEqual((yield* host.catalogue)[0]!.tile?.icon, 'note');
          yield* host.setEnabled('notes', true);
          const input = { id: 'ideas', title: 'Idées' };
          yield* host.invoke('notes', 'note', input);
          assert.deepStrictEqual(opened, ['ideas']);
          assert.strictEqual(captures, 0);
          yield* host.invoke('notes', 'note', input, {
            output: () => Effect.void,
            gesture: 'long-press',
            released: Effect.void,
          });
          assert.strictEqual((yield* notes.read('ideas')).body, 'Texte dicté.');
          const held = yield* Effect.forkScoped(
            host.invoke('notes', 'note', input, {
              output: () => Effect.void,
              gesture: 'long-press',
              released: Effect.never,
            }),
          );
          yield* Effect.repeat(speech.activity, {
            until: (s) => s.phase === 'recording',
            schedule: Schedule.spaced(1),
          });
          assert.strictEqual((yield* host.feedback('notes', 'note', input))?.text, 'ÉCOUTE');
          yield* host.setEnabled('notes', false);
          yield* Fiber.await(held);
          assert.strictEqual(stopped, 2);
          assert.strictEqual((yield* speech.activity).phase, 'idle');
          assert.strictEqual((yield* notes.read('ideas')).body, 'Texte dicté.');
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              Mock.make().layer(),
              Layer.succeed(Notes.Notes, notes),
              Layer.succeed(Speech.Speech, speech),
              Layer.succeed(NotePlugin.NoteOpener, {
                open: (id) =>
                  Effect.sync(() => {
                    opened.push(id);
                  }),
              }),
            ),
          ),
        );
      }),
    ).pipe(Effect.provide(NodeServices.layer), Effect.timeout('5 seconds')),
);

const base = { id: 'ideas', title: 'Idées', body: 'Saved', revision: 1 };
it.effect('cancelled tap/hold input neither opens a note nor appends a partial capture', () =>
  Effect.scoped(
    Effect.gen(function* () {
      let opened = 0;
      let appended = 0;
      let stopped = 0;
      for (const gesture of ['press', 'long-press'] as const) {
        const release = yield* Deferred.make<void>();
        const cancelled = yield* Deferred.make<void>();
        const run = yield* Effect.forkScoped(
          Plugin.tapOrHold(
            {
              output: () => Effect.void,
              gesture,
              released: Deferred.await(release),
              cancelled: Deferred.await(cancelled),
            },
            Effect.sync(() => {
              opened++;
            }),
            (released) =>
              released.pipe(
                Effect.andThen(Effect.sleep('1 second')),
                Effect.andThen(
                  Effect.sync(() => {
                    appended++;
                  }),
                ),
                Effect.ensuring(
                  Effect.sync(() => {
                    stopped++;
                  }),
                ),
              ),
          ),
        );
        yield* TestClock.adjust(100);
        yield* Deferred.succeed(cancelled, undefined);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.await(run);
      }
      assert.strictEqual(opened, 0);
      assert.strictEqual(appended, 0);
      assert.strictEqual(stopped, 1);
    }),
  ),
);
it('dictation merges with unsaved typing, preserving local title and ignoring stale polls', () => {
  const draft = { ...Draft.fromNote(base), title: 'My title', body: 'Saved plus typing' };
  const remote = { ...base, body: 'Saved\nDictation', revision: 2 };
  const merged = Draft.receive(draft, remote);
  assert.strictEqual(merged.body, 'Saved plus typing\nDictation');
  assert.strictEqual(merged.title, 'My title');
  assert.strictEqual(merged.base.revision, 2);
  assert.strictEqual(merged.conflict, false);
  assert.strictEqual(Draft.receive(merged, base), merged);
  assert.ok(Draft.dirty(merged));
});
it('a remote replacement preserves the draft and requires conflict resolution', () => {
  const draft = { ...Draft.fromNote(base), body: 'Local edit' };
  const merged = Draft.receive(draft, { ...base, body: 'Remote edit', revision: 2 });
  assert.strictEqual(merged.body, 'Local edit');
  assert.ok(merged.conflict);
  assert.strictEqual(
    Draft.receive(merged, { ...base, body: 'Saved suffix', revision: 3 }).conflict,
    true,
  );
});

it.live(
  'note HTTP works without hardware, protects saves and returns conflicts and invalid IDs',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: 'notes-http-' });
        yield* Effect.gen(function* () {
          const studio = yield* startStudio({
            profile: `${root}/profile.json`,
            mock: true,
            applications: [],
            configurePlugins: () => Effect.void,
          });
          const server = yield* HttpServer.HttpServer;
          const origin = 'http://127.0.0.1:3901';
          yield* server.serve(yield* httpApp(studio, [origin]));
          const client = yield* HttpClient.HttpClient;
          const put = HttpClientRequest.put('/api/notes').pipe(
            HttpClientRequest.setHeaders({ origin, 'x-streamdeck-studio': '1' }),
            HttpClientRequest.bodyJsonUnsafe({
              id: 'ideas',
              title: 'Idées',
              body: 'A note',
              expectedRevision: 0,
            }),
          );
          assert.strictEqual(
            (yield* client.execute(
              put.pipe(HttpClientRequest.setHeader('origin', 'https://elsewhere.example')),
            )).status,
            403,
          );
          assert.strictEqual((yield* client.execute(put)).status, 200);
          assert.strictEqual((yield* client.execute(put)).status, 409);
          const read = yield* client.get('/api/notes?id=ideas');
          assert.strictEqual(read.status, 200);
          assert.deepStrictEqual(yield* read.json, {
            note: { id: 'ideas', title: 'Idées', body: 'A note', revision: 1 },
            activity: { target: null, phase: 'idle' },
          });
          assert.strictEqual((yield* client.get('/api/notes?id=..%2Fescape')).status, 400);
          assert.strictEqual(yield* fs.exists(`${root}/profile.json`), false);
        }).pipe(
          Effect.provide(
            Layer.mergeAll(Mock.make().layer(), Audio.demoLayer, NodeHttpServer.layerTest),
          ),
        );
      }),
    ).pipe(Effect.provide(NodeServices.layer), Effect.timeout('5 seconds')),
);
