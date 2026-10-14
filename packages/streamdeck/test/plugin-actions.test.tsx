import { assert, it } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import { Config, Effect, FileSystem, Layer, Ref, Schedule, Schema, Stream } from 'effect';
import * as Plugin from '../src/plugin.ts';
import * as Host from '../src/plugin-host.ts';
import * as Fields from '../src/plugin-fields.ts';
import * as Mock from '../src/mock.ts';
import * as Audio from '@nixfiles/system-control/audio.ts';
import * as Takumi from '../src/takumi.ts';
import * as Display from '../src/display.ts';
import * as SourceView from '../src/plugins/source-view.ts';
import { startStudio } from '../src/scripts/studio.ts';
const inputSchema = Schema.Struct({
  amount: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 })).annotate({
    title: 'Quantité',
  }),
  enabled: Schema.Boolean,
  title: Schema.String,
  direction: Schema.Literals([-1, 1]),
  complex: Schema.Array(Schema.String),
  optional: Schema.optional(Schema.String),
});
it('projects schema fields and preserves parameter types and complex JSON', () => {
  const schema = Schema.toJsonSchemaDocument(inputSchema);
  const fields = Fields.fields(schema);
  assert.strictEqual(fields[0]!.key, 'amount');
  assert.strictEqual(fields[0]!.label, 'Quantité');
  assert.strictEqual(fields[0]!.min, 1);
  const value = { amount: 2, enabled: true, title: 'Hello', direction: -1, complex: ['a', 'b'] };
  assert.deepStrictEqual(Fields.input(schema, Fields.draft(schema, value)), value);
  assert.throws(() =>
    Fields.input(schema, { ...Fields.draft(schema, value), 'input:complex': '[' }),
  );
});
it.live(
  'plugin actions validate before saving, share physical/web dispatch and fail clearly when disabled',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'plugin-action-' });
        const mock = Mock.make();
        yield* Effect.gen(function* () {
          const total = yield* Ref.make(0);
          const action = Plugin.action({
            id: 'add',
            name: 'Ajouter',
            description: '',
            input: Schema.Struct({ amount: Schema.Int.check(Schema.isGreaterThan(0)) }),
            defaults: { amount: 1 },
            run: (
              api: {
                add: (value: number) => Effect.Effect<number>;
              },
              { amount },
            ) => api.add(amount),
          });
          const plugin = Plugin.define({
            id: 'numbers',
            name: 'Numbers',
            description: '',
            controls: {},
            actions: [action],
            setup: Effect.succeed({
              api: { add: (value: number) => Ref.updateAndGet(total, (n) => n + value) },
            }),
          });
          const studio = yield* startStudio({
            profile: `${directory}/profile.json`,
            mock: true,
            applications: [],
            configurePlugins: (host) => host.install(plugin),
          });
          const binding = {
            label: 'Ajouter',
            action: 'plugin',
            parameters: { plugin: 'numbers', command: 'add', input: { amount: 3 } },
          };
          assert.strictEqual(
            (yield* Effect.result(
              studio.actions.save(0, {
                ...binding,
                parameters: { ...binding.parameters, input: { amount: -1 } },
              }),
            ))._tag,
            'Failure',
          );
          assert.strictEqual(yield* fs.exists(`${directory}/profile.json`), false);
          yield* studio.actions.save(0, binding);
          yield* studio.setPlugin({ id: 'numbers', enabled: true, expected: false });
          yield* studio.actions.press(0);
          yield* Effect.repeat(studio.snapshot, {
            until: (view) => view.keys[0]!.status === 'success',
            schedule: Schedule.spaced(1),
          });
          assert.strictEqual(yield* Ref.get(total), 3);
          yield* mock.emit({ _tag: 'KeyDown', key: 0 });
          yield* Effect.repeat(Ref.get(total), {
            until: (value) => value === 6,
            schedule: Schedule.spaced(1),
          });
          yield* studio.setPlugin({ id: 'numbers', enabled: false, expected: true });
          yield* Effect.repeat(studio.snapshot, {
            until: (view) => view.keys[0]!.status !== 'running',
            schedule: Schedule.spaced(1),
          });
          yield* studio.actions.press(0);
          const failed = yield* Effect.repeat(studio.snapshot, {
            until: (view) => view.keys[0]!.status === 'error',
            schedule: Schedule.spaced(1),
          });
          assert.ok(failed.keys[0]!.detail.includes('Active Numbers'));
          assert.strictEqual(yield* Ref.get(total), 6);
        }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(mock.layer(), Audio.demoLayer)));
      }),
    ).pipe(Effect.provide(NodeServices.layer), Effect.timeout('5 seconds')),
);
it.live(
  'shared raster cache avoids native work, protects cached bytes and invalidates full feedback after region writes',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const renderer = yield* Takumi.make;
        const mock = Mock.make();
        const view = (
          <div style={{ width: '100%', height: '100%', background: '#ff0000' }}>Hello</div>
        );
        const first = yield* renderer.png(view, { width: 112, height: 112 });
        first.fill(0);
        const next = yield* renderer.png(view, { width: 112, height: 112 });
        assert.notStrictEqual(next[0], 0);
        assert.strictEqual((yield* renderer.stats).renders, 1);
        assert.strictEqual((yield* renderer.stats).hits, 1);
        yield* Effect.gen(function* () {
          const display = yield* Display.make;
          yield* display.key(0, view);
          const writes = mock.writes.length;
          yield* display.key(0, view);
          assert.strictEqual(mock.writes.length, writes);
          yield* display.lcd(0, view);
          const full = mock.writes.length;
          yield* display.region(0, { x: 0, y: 0, width: 20, height: 20 }, view);
          yield* display.lcd(0, view);
          assert.strictEqual(mock.writes.length, full + 2);
        }).pipe(
          Effect.provideService(Takumi.ReactRenderer, renderer),
          Effect.provide(mock.layer()),
        );
      }),
    ),
);
it.live('source view coalesces visual snapshots while retaining their final state', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const mock = Mock.make();
      yield* Effect.gen(function* () {
        const host = yield* Host.make;
        const handle = yield* host.install(
          SourceView.key(0, {
            id: 'view',
            name: 'View',
            source: Stream.fromArray(Array.from({ length: 50 }, (_, index) => index)),
            frameMillis: 1,
            view: (value) => <div>{String(value)}</div>,
          }),
        );
        yield* host.setEnabled(handle.id, true);
        yield* Effect.repeat(
          handle.use((api) => api.state),
          {
            until: (state) => state._tag === 'Some' && state.value === 49,
            schedule: Schedule.spaced(1),
          },
        );
        yield* host.setEnabled(handle.id, false);
        assert.ok(mock.writes.filter((write) => write.kind === 'key').length < 50);
      }).pipe(Effect.scoped, Effect.provide(mock.layer()));
    }),
  ).pipe(Effect.timeout('5 seconds')),
);
it.live(
  'disabling a plugin interrupts its action and releases the shortcut from running state',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'plugin-action-stop-' });
        const mock = Mock.make();
        yield* Effect.gen(function* () {
          const started = yield* Ref.make(false);
          const stopped = yield* Ref.make(false);
          const plugin = Plugin.define({
            id: 'slow',
            name: 'Slow',
            description: '',
            controls: {},
            actions: [
              Plugin.action({
                id: 'wait',
                name: 'Wait',
                description: '',
                input: Schema.Struct({}),
                defaults: {},
                run: (_api: undefined) =>
                  Effect.gen(function* () {
                    yield* Effect.addFinalizer(() => Ref.set(stopped, true));
                    yield* Ref.set(started, true);
                    yield* Effect.never;
                  }),
              }),
            ],
            setup: Effect.succeed({ api: undefined }),
          });
          const studio = yield* startStudio({
            profile: `${directory}/profile.json`,
            mock: true,
            applications: [],
            configurePlugins: (host) => host.install(plugin),
          });
          yield* studio.setPlugin({ id: 'slow', enabled: true, expected: false });
          yield* studio.actions.save(0, {
            label: 'Wait',
            action: 'plugin',
            parameters: { plugin: 'slow', command: 'wait', input: {} },
          });
          yield* studio.actions.press(0);
          yield* Effect.repeat(Ref.get(started), { until: Boolean, schedule: Schedule.spaced(1) });
          yield* studio.setPlugin({ id: 'slow', enabled: false, expected: true });
          const view = yield* Effect.repeat(studio.snapshot, {
            until: (view) => view.keys[0]!.status === 'error',
            schedule: Schedule.spaced(1),
          });
          assert.strictEqual(yield* Ref.get(stopped), true);
          assert.ok(view.keys[0]!.detail.length > 0);
          yield* studio.actions.save(0, null);
        }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(mock.layer(), Audio.demoLayer)));
      }),
    ).pipe(Effect.provide(NodeServices.layer), Effect.timeout('5 seconds')),
);
it.live(
  'command plugin cancellation preserves other features and releases the owning process',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'command-plugin-stop-' });
        const mock = Mock.make();
        const node = yield* Config.String('npm_node_execpath');
        yield* Effect.gen(function* () {
          const studio = yield* startStudio({
            profile: `${directory}/profile.json`,
            mock: true,
            applications: [],
          });
          yield* studio.actions.save(0, {
            label: 'Command',
            action: 'run-command',
            parameters: {
              executable: node,
              arguments: ['-e', 'console.log(process.pid); setInterval(() => {}, 10000)'],
              directory: '',
            },
          });
          yield* studio.actions.press(0);
          const before = yield* Effect.repeat(studio.snapshot, {
            until: (view) => !!view.keys[0]!.detail.trim(),
            schedule: Schedule.spaced(1),
          });
          const firstPid = Number(before.keys[0]!.detail.trim());
          yield* studio.actions.cancel(0);
          assert.strictEqual((yield* studio.snapshot).keys[0]!.status, 'idle');
          assert.strictEqual(yield* fs.exists(`/proc/${firstPid}`), false);
          yield* studio.actions.press(0);
          const again = yield* Effect.repeat(studio.snapshot, {
            until: (view) => !!view.keys[0]!.detail.trim(),
            schedule: Schedule.spaced(1),
          });
          const pid = Number(again.keys[0]!.detail.trim());
          yield* studio.setPlugin({ id: 'commands', enabled: false, expected: true });
          yield* Effect.repeat(studio.snapshot, {
            until: (view) => view.keys[0]!.status === 'error',
            schedule: Schedule.spaced(1),
          });
          assert.strictEqual(yield* fs.exists(`/proc/${pid}`), false);
          assert.strictEqual(
            (yield* studio.snapshot).plugins.items.find((plugin) => plugin.id === 'shortcuts')!
              .enabled,
            true,
          );
          yield* studio.actions.save(0, {
            label: 'Count',
            action: 'counter',
            parameters: { start: 0 },
          });
          yield* studio.actions.press(0);
          assert.strictEqual((yield* studio.snapshot).keys[0]!.count, 1);
        }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(mock.layer(), Audio.demoLayer)));
      }),
    ).pipe(Effect.provide(NodeServices.layer), Effect.timeout('5 seconds')),
);
it.live('a broken finalizer is reported without retaining control ownership', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const mock = Mock.make();
      yield* Effect.gen(function* () {
        const host = yield* Host.make;
        yield* host.install(
          Plugin.define({
            id: 'broken-cleanup',
            name: 'Broken cleanup',
            description: '',
            controls: { keys: [0] },
            setup: Effect.gen(function* () {
              yield* Effect.addFinalizer(() => Effect.die(new Error('unsubscribe failed')));
              return { api: {} };
            }),
          }),
        );
        yield* host.install(
          Plugin.define({
            id: 'replacement',
            name: 'Replacement',
            description: '',
            controls: { keys: [0] },
            setup: Effect.succeed({ api: {} }),
          }),
        );
        yield* host.setEnabled('broken-cleanup', true);
        yield* host.setEnabled('broken-cleanup', false);
        assert.strictEqual((yield* host.snapshot).items[0]!.phase, 'error');
        assert.ok((yield* host.snapshot).items[0]!.detail.includes('unsubscribe failed'));
        yield* host.setEnabled('replacement', true);
        assert.strictEqual((yield* host.snapshot).items[1]!.enabled, true);
      }).pipe(Effect.scoped, Effect.provide(mock.layer()));
    }),
  ),
);
