import { assert, it } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import { Cause, ConfigProvider, Deferred, Effect, Fiber, Layer } from 'effect';
import { DesktopKeys, makeDiscordKeys } from '../src/desktop-keys.ts';
import { IntegrationError } from '@nixfiles/system-control/errors.ts';
import { DiscordTransport } from '@nixfiles/system-control/discord-ipc.ts';
import { DiscordOAuth } from '@nixfiles/system-control/discord-connection.ts';
import * as Discord from '../src/plugins/discord.ts';
import { failureMessage } from '../src/failure-message.ts';
import * as Api from '../web/api.ts';
import * as Host from '../src/plugin-host.ts';
import * as Plugin from '../src/plugin.ts';
import * as Mock from '../src/mock.ts';

const desktop = (
  options: {
    missing?: boolean;
    failChord?: boolean;
    failFocus?: boolean;
    changeFocus?: boolean;
  } = {},
) => {
  let focused = 1;
  const calls: Array<string> = [];
  const windows = Effect.sync(() => [
    { id: 1, app_id: 'editor', is_focused: focused === 1 },
    ...(options.missing ? [] : [{ id: 2, app_id: 'discord', is_focused: focused === 2 }]),
    { id: 3, app_id: 'other', is_focused: focused === 3 },
  ]);
  const layer = Layer.succeed(DesktopKeys, {
    ready: Effect.void,
    windows,
    focus: (id) =>
      Effect.sync(() => {
        calls.push(`focus ${id}`);
        if (!options.failFocus) focused = id;
      }),
    chord: (key) =>
      Effect.gen(function* () {
        assert.strictEqual(focused, 2);
        calls.push(`chord ${key}`);
        if (options.changeFocus) focused = 3;
        if (options.failChord)
          return yield* Effect.fail(new IntegrationError({ message: 'Shortcut refused' }));
      }),
  });
  return { layer, calls };
};

it.live('explicit legacy auto mode uses local chords without OAuth and restores focus', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const mock = desktop();
      const api = yield* Discord.configured.pipe(
        Effect.provide(Layer.mergeAll(mock.layer, DiscordTransport.layer, DiscordOAuth.layer)),
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromEnvRecord({ STREAMDECK_DISCORD_BACKEND: 'auto' }),
        ),
      );
      assert.deepStrictEqual(yield* api.current, {
        backend: 'keyboard',
        windowOpen: true,
        mute: null,
        deaf: null,
      });
      yield* api.toggle('mute');
      yield* api.toggle('deaf');
      assert.deepStrictEqual(mock.calls, [
        'focus 2',
        'chord m',
        'focus 1',
        'focus 2',
        'chord d',
        'focus 1',
      ]);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect('missing Discord sends no input; input failure restores the previous window', () =>
  Effect.gen(function* () {
    const absent = desktop({ missing: true });
    const api = yield* makeDiscordKeys.pipe(Effect.provide(absent.layer));
    assert.strictEqual((yield* Effect.result(api.toggle('mute')))._tag, 'Failure');
    assert.deepStrictEqual(absent.calls, []);
    const failed = desktop({ failChord: true });
    const broken = yield* makeDiscordKeys.pipe(Effect.provide(failed.layer));
    assert.strictEqual((yield* Effect.result(broken.toggle('mute')))._tag, 'Failure');
    assert.deepStrictEqual(failed.calls, ['focus 2', 'chord m', 'focus 1']);
    const moved = desktop({ changeFocus: true });
    const changed = yield* makeDiscordKeys.pipe(Effect.provide(moved.layer));
    yield* changed.toggle('mute');
    assert.deepStrictEqual(moved.calls, ['focus 2', 'chord m']);
  }),
);

it.live('failed focus cannot send the Discord chord to another application', () =>
  Effect.gen(function* () {
    const mock = desktop({ failFocus: true });
    const api = yield* makeDiscordKeys.pipe(Effect.provide(mock.layer));
    assert.strictEqual((yield* Effect.result(api.toggle('mute')))._tag, 'Failure');
    assert.deepStrictEqual(mock.calls, ['focus 2']);
  }),
);

it.live('cancelling a shortcut restores the original window through its finalizer', () =>
  Effect.scoped(
    Effect.gen(function* () {
      let focused = 1;
      const calls: Array<number> = [];
      const started = yield* Deferred.make<void>();
      const api = yield* makeDiscordKeys.pipe(
        Effect.provideService(DesktopKeys, {
          ready: Effect.void,
          windows: Effect.sync(() => [
            { id: 1, app_id: 'editor', is_focused: focused === 1 },
            { id: 2, app_id: 'discord', is_focused: focused === 2 },
          ]),
          focus: (id) =>
            Effect.sync(() => {
              focused = id;
              calls.push(id);
            }),
          chord: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
        }),
      );
      const fiber = yield* Effect.forkScoped(api.toggle('mute'));
      yield* Deferred.await(started);
      yield* Fiber.interrupt(fiber);
      assert.deepStrictEqual(calls, [2, 1]);
      assert.strictEqual(focused, 1);
    }),
  ),
);

it.live('an explicitly requested RPC connection retains its configuration error', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const result = yield* Effect.result(
        Discord.configured.pipe(
          Effect.provide(
            Layer.mergeAll(desktop().layer, DiscordTransport.layer, DiscordOAuth.layer),
          ),
          Effect.provideService(
            ConfigProvider.ConfigProvider,
            ConfigProvider.fromEnvRecord({ STREAMDECK_DISCORD_BACKEND: 'rpc' }),
          ),
        ),
      );
      assert.strictEqual(result._tag, 'Failure');
      if (result._tag === 'Failure')
        assert.ok(result.failure.message.includes('Connexion RPC Discord à configurer'));
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.live(
  'plugin failures expose the domain message, and the React bridge unwraps it without a stack',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const original = new IntegrationError({ message: 'Ouvre Discord.' });
        assert.strictEqual(failureMessage(Cause.fail(original)), 'Ouvre Discord.');
        assert.strictEqual(
          failureMessage(Cause.die(new Error('Cleanup failed'))),
          'Cleanup failed',
        );
        yield* Effect.promise(async () => {
          let thrown: unknown;
          try {
            await Api.run(Effect.fail(original));
          } catch (error) {
            thrown = error;
          }
          assert.strictEqual(thrown, original);
        });
        const mock = Mock.make();
        yield* Effect.scoped(
          Effect.gen(function* () {
            const host = yield* Host.make;
            yield* host.install(
              Plugin.define({
                id: 'missing',
                name: 'Missing',
                description: '',
                controls: {},
                setup: Effect.fail(original),
              }),
            );
            const result = yield* Effect.result(host.setEnabled('missing', true));
            assert.strictEqual(result._tag, 'Failure');
            if (result._tag === 'Failure')
              assert.strictEqual(result.failure.message, 'Ouvre Discord.');
            assert.strictEqual((yield* host.snapshot).items[0]!.detail, 'Ouvre Discord.');
          }).pipe(Effect.provide(mock.layer())),
        );
      }),
    ),
);
