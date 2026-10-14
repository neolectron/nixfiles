import { assert, it } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import { Clock, Effect, Ref, Result, Schema } from 'effect';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Dot from '@nixfiles/system-control/dot-call.ts';
import * as Desktop from '@nixfiles/system-control/desktop.ts';
import { IntegrationError } from '@nixfiles/system-control/errors.ts';
import * as OpenAI from '../src/plugins/openai-apps.ts';
import * as Call from '../src/plugins/openai-call.ts';
import * as Plugin from '../src/plugin.ts';
import * as Host from '../src/plugin-host.ts';
import * as Mock from '../src/mock.ts';
import { KeyCard } from '../src/ui/key-card.tsx';

it('OpenAI exports call, hangup and status tiles with no parameters and formats long calls', () => {
  assert.deepStrictEqual(
    Call.actions.map((action) => action.info.id),
    ['dot-call', 'dot-hangup', 'dot-call-status'],
  );
  for (const action of Call.actions) {
    assert.ok(OpenAI.plugin.actions!.includes(action));
    assert.deepStrictEqual(Schema.decodeUnknownSync(Plugin.NoInput)(action.info.defaults), {});
  }
  assert.strictEqual(Call.duration(0), '00:00');
  assert.strictEqual(Call.duration(65), '01:05');
  assert.strictEqual(Call.duration(3661), '1:01:01');
});

it.live(
  'the complete OpenAI plugin remains usable offline, follows call state and routes explicit controls',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const state = yield* Ref.make<Result.Result<Dot.Status, IntegrationError>>(
          Result.fail(new IntegrationError({ message: 'Bridge missing' })),
        );
        let started = 0;
        const ended: string[] = [];
        const dot = yield* Dot.make.pipe(
          Effect.provideService(Dot.DotCallBackend, {
            read: Ref.get(state).pipe(Effect.flatMap(Effect.fromResult)),
            call: Effect.gen(function* () {
              started++;
              const value: Dot.Status = {
                phase: 'active',
                callId: 'test',
                startedAt: yield* Clock.currentTimeMillis,
              };
              yield* Ref.set(state, Result.succeed(value));
              return value;
            }),
            hangup: (id) =>
              Effect.sync(() => ended.push(id)).pipe(
                Effect.andThen(Ref.set(state, Result.succeed(Dot.idle))),
                Effect.as(Dot.idle),
              ),
          }),
        );
        const desktop = yield* Desktop.make.pipe(
          Effect.provideService(Desktop.DesktopBackend, {
            applications: Effect.succeed([]),
            windows: Effect.succeed([]),
            launch: () => Effect.die('Unexpected launch'),
            focus: () => Effect.die('Unexpected focus'),
          }),
        );
        yield* Effect.gen(function* () {
          const host = yield* Host.make;
          yield* host.install(OpenAI.plugin);
          yield* host.setEnabled('openai-apps', true);
          assert.strictEqual(
            (yield* host.feedback('openai-apps', 'dot-call', {}))?.text,
            'À CONNECTER',
          );
          assert.strictEqual(
            (yield* host.catalogue).filter((action) => action.plugin === 'openai-apps').length,
            9,
          );
          assert.strictEqual(started, 0);
          yield* Ref.set(state, Result.succeed(Dot.idle));
          yield* dot.refresh;
          assert.strictEqual(
            (yield* host.feedback('openai-apps', 'dot-call', {}))?.label,
            'Appeler le dot',
          );
          yield* host.invoke('openai-apps', 'dot-call-status', {});
          assert.strictEqual(started, 0);
          yield* host.invoke('openai-apps', 'dot-call', {});
          const feedback = (yield* host.feedback('openai-apps', 'dot-call', {}))!;
          assert.strictEqual(feedback.label, 'Raccrocher le dot');
          assert.strictEqual(feedback.icon, 'phone-end');
          const html = renderToStaticMarkup(
            <KeyCard
              width={100}
              height={100}
              label="Appeler le dot"
              action="plugin"
              count={0}
              status="idle"
              feedback={feedback}
            />,
          );
          assert.include(html, 'Raccrocher le dot');
          assert.strictEqual(html.includes('Appeler le dot'), false);
          yield* host.invoke('openai-apps', 'dot-hangup', {});
          assert.deepStrictEqual(ended, ['test']);
          assert.strictEqual(started, 1);
          assert.strictEqual(
            (yield* host.feedback('openai-apps', 'dot-call-status', {}))?.text,
            'INACTIF',
          );
          yield* host.setEnabled('openai-apps', false);
          assert.ok(
            Result.isFailure(yield* Effect.result(host.invoke('openai-apps', 'dot-call', {}))),
          );
          assert.strictEqual(started, 1);
        }).pipe(
          Effect.provideService(Dot.DotCall, dot),
          Effect.provideService(Desktop.Desktop, desktop),
        );
      }),
    ).pipe(Effect.provide(NodeServices.layer), Effect.provide(Mock.make().layer())),
);
