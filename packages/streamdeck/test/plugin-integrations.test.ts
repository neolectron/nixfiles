import { assert, it } from '@effect/vitest';
import { NodeServices, NodeSocketServer } from '@effect/platform-node';
import { ConfigProvider, Deferred, Effect, Fiber, FileSystem, Layer, Redacted, Ref, Schedule, Schema } from 'effect';
import { JsonSocket, IntegrationError, type Message } from '../src/json-socket.ts';
import * as Obs from '../src/plugins/obs.ts';
import * as Discord from '../src/plugins/discord.ts';
import * as Talk from '../src/plugins/push-to-talk.ts';
import { commandFromConfig } from '../src/plugins/command-bridge.ts';
import * as Mock from '../src/mock.ts';
import * as Audio from '../src/audio.ts';
import { startStudio } from '../src/scripts/studio.ts';
import * as Plugin from '../src/plugin.ts';
import * as Fields from '../src/plugin-fields.ts';

it('parameter-free actions accept only an empty object and generate no editor fields', () => {
  const decode = Schema.decodeUnknownSync(Plugin.NoInput);
  assert.deepStrictEqual(decode({}), {}); assert.throws(() => decode({ unexpected: true })); assert.throws(() => decode(''));
  assert.deepStrictEqual(Fields.fields(Schema.toJsonSchemaDocument(Plugin.NoInput)), []);
});

it.live('OBS authenticates against a real loopback WebSocket and routes correlated success/errors', () => Effect.scoped(Effect.gen(function*() {
  assert.strictEqual(yield* Obs.authentication(Redacted.make('password'), 'salt', 'challenge'), 'zTM5ki6L2vVvBQiTG9ckH1Lh64AbnCf6XZ226UmnkIA=');
  const received: Array<Message> = [];
  const server = yield* NodeSocketServer.makeWebSocket({ host: '127.0.0.1', port: 0 });
  if (server.address._tag === 'UnixPathAddress') throw new Error('Expected TCP address');
  const port = server.address.port;
  const serverFiber = yield* Effect.forkScoped(server.run((socket) => Effect.scoped(Effect.gen(function*() {
    const reader = yield* socket.reader; const writer = yield* socket.writer;
    yield* writer.write(JSON.stringify({ op: 0, d: { rpcVersion: 1, authentication: { salt: 'salt', challenge: 'challenge' } } }));
    yield* Effect.forever(Effect.gen(function*() {
      for (const bytes of yield* reader.pull) {
        const frame = JSON.parse(typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes)); received.push(frame);
        if (frame.op === 1) { assert.strictEqual(frame.d.authentication, 'zTM5ki6L2vVvBQiTG9ckH1Lh64AbnCf6XZ226UmnkIA='); yield* writer.write(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } })); }
        else if (frame.op === 6) yield* writer.write(JSON.stringify({ op: 7, d: { requestId: frame.d.requestId, requestStatus: { result: frame.d.requestType !== 'Unknown', comment: 'Unknown request' }, responseData: { type: frame.d.requestType } } }));
      }
    }));
  }))));
  yield* Effect.scoped(Effect.gen(function*() {
    const obs = yield* Obs.make({ url: `ws://127.0.0.1:${port}`, password: Redacted.make('password') });
    assert.deepStrictEqual(yield* Effect.all([obs.request('GetRecordStatus'), obs.request('GetStreamStatus')], { concurrency: 'unbounded' }), [{ type: 'GetRecordStatus' }, { type: 'GetStreamStatus' }]);
    const error = yield* Effect.result(obs.request('Unknown')); assert.strictEqual(error._tag, 'Failure');
    if (error._tag === 'Failure') assert.ok(error.failure.message.includes('Unknown request'));
    assert.ok(received.every((message) => message.op !== 6 || !['ToggleRecord', 'ToggleStream'].includes((message.d as Message).requestType as string)));
  }).pipe(Effect.provide(JsonSocket.layer)));
  yield* Fiber.interrupt(serverFiber);
})).pipe(Effect.provide(NodeServices.layer), Effect.timeout('8 seconds')));

it.live('a disconnected WebSocket fails in-flight OBS requests without waiting for their timeout', () => Effect.scoped(Effect.gen(function*() {
  const disconnected = yield* Deferred.make<never, IntegrationError>();
  const layer = Layer.succeed(JsonSocket, { connect: (_url, receive) => Effect.gen(function*() {
    yield* receive({ op: 0, d: { rpcVersion: 1 } });
    return { failure: Deferred.await(disconnected), send: (frame: Message) => frame.op === 1 ? receive({ op: 2, d: {} }) : Deferred.fail(disconnected, new IntegrationError({ message: 'Disconnected' })).pipe(Effect.asVoid) };
  }) });
  const api = yield* Obs.make({ url: 'ws://mock', password: Redacted.make('') }).pipe(Effect.provide(layer));
  const result = yield* Effect.result(api.request('GetRecordStatus')); assert.strictEqual(result._tag, 'Failure');
  if (result._tag === 'Failure') assert.strictEqual(result.failure.message, 'Disconnected');
})).pipe(Effect.provide(NodeServices.layer), Effect.timeout('1 second')));

it.live('Discord authenticates and serializes real-state toggles without changing unrelated voice fields', () => Effect.scoped(Effect.gen(function*() {
  let mute = false; let deaf = false; const sent: Array<Message> = [];
  const layer = Layer.succeed(JsonSocket, { connect: (_url, receive) => Effect.gen(function*() {
    yield* receive({ evt: 'READY', data: {} });
    return { failure: Effect.never, send: (frame: Message) => Effect.gen(function*() {
      sent.push(frame); const args = frame.args as Message;
      if (frame.cmd === 'SET_VOICE_SETTINGS') { if (typeof args.mute === 'boolean') mute = args.mute; if (typeof args.deaf === 'boolean') deaf = args.deaf; }
      yield* receive({ nonce: frame.nonce, data: { mute, deaf } });
    }) };
  }) });
  const api = yield* Discord.make({ clientId: '123', accessToken: Redacted.make('test-only-token') }).pipe(Effect.provide(layer));
  yield* Effect.all([api.toggle('mute'), api.toggle('mute')], { concurrency: 'unbounded' });
  yield* api.toggle('deaf'); assert.deepStrictEqual(yield* api.current, { mute: false, deaf: true });
  assert.strictEqual(sent[0]!.cmd, 'AUTHENTICATE');
  assert.deepStrictEqual(sent.filter((frame) => frame.cmd === 'SET_VOICE_SETTINGS').map((frame) => frame.args), [{ mute: true }, { mute: false }, { deaf: true }]);
})).pipe(Effect.provide(NodeServices.layer)));

it.live('push-to-talk releases the original binding after paging, rejects stale web releases and stops on disable', () => Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem; const dir = yield* fs.makeTempDirectoryScoped({ prefix: 'plugin-talk-' }); const mock = Mock.make();
  const starts = yield* Ref.make(0); const stops = yield* Ref.make(0);
  const target = Layer.succeed(Talk.VoiceTarget, { start: Ref.update(starts, (n) => n + 1), stop: Ref.update(stops, (n) => n + 1) });
  yield* Effect.scoped(Effect.gen(function*() {
    const studio = yield* startStudio({ profile: `${dir}/profile.json`, applications: [], mock: true, configurePlugins: (host) => host.install(Talk.plugin(target)) });
    yield* studio.setPlugin({ id: 'dot-voice', enabled: true, expected: false });
    yield* studio.actions.save(0, { label: 'Parler', action: 'plugin', parameters: { plugin: 'dot-voice', command: 'talk', input: {} } });
    const address = (yield* studio.snapshot).keys[0]!.address;
    yield* mock.emit({ _tag: 'KeyDown', key: 0 });
    yield* Effect.repeat(Ref.get(starts), { until: (n) => n === 1, schedule: Schedule.spaced(1) });
    yield* studio.actions.organize({ operation: 'add-page', zone: 'deck', revision: (yield* studio.snapshot).layout.revision });
    const otherAddress = (yield* studio.snapshot).keys[0]!.address;
    assert.notStrictEqual(address, otherAddress);
    yield* studio.actions.release(0, otherAddress); assert.strictEqual(yield* Ref.get(stops), 0);
    yield* mock.emit({ _tag: 'KeyUp', key: 0 });
    yield* Effect.repeat(Ref.get(stops), { until: (n) => n === 1, schedule: Schedule.spaced(1) });
    yield* studio.actions.navigate({ zone: 'deck', operation: 'previous' });
    yield* Effect.repeat(studio.snapshot, { until: (view) => view.keys[0]!.status === 'success', schedule: Schedule.spaced(1) });
    yield* studio.actions.press(0, address);
    yield* Effect.repeat(Ref.get(starts), { until: (n) => n === 2, schedule: Schedule.spaced(1) });
    yield* studio.setPlugin({ id: 'dot-voice', enabled: false, expected: true });
    assert.strictEqual(yield* Ref.get(stops), 2);
    yield* Effect.repeat(studio.snapshot, { until: (view) => view.keys[0]!.status === 'error', schedule: Schedule.spaced(1) });
  }).pipe(Effect.provide(Layer.mergeAll(mock.layer(), Audio.demoLayer))));
})).pipe(Effect.provide(NodeServices.layer), Effect.timeout('5 seconds')));

it.live('voice cleanup runs on partial start failure and reports stop failures', () => Effect.scoped(Effect.gen(function*() {
  const stops = yield* Ref.make(0);
  const target = Layer.succeed(Talk.VoiceTarget, { start: Effect.fail(new IntegrationError({ message: 'Partial start failure' })), stop: Ref.update(stops, (n) => n + 1) });
  const api = yield* Talk.make.pipe(Effect.provide(target));
  assert.strictEqual((yield* Effect.result(api.hold({ output: () => Effect.void, released: Effect.void })))._tag, 'Failure');
  assert.strictEqual(yield* Ref.get(stops), 1);
  const broken = yield* Talk.make.pipe(Effect.provideService(Talk.VoiceTarget, { start: Effect.void, stop: Effect.fail(new IntegrationError({ message: 'Stop failed' })) }));
  assert.strictEqual((yield* Effect.exit(broken.hold({ output: () => Effect.void, released: Effect.void })))._tag, 'Failure');
})));

it.live('command bridges require explicit literal argv configuration and never execute on setup', () => Effect.scoped(Effect.gen(function*() {
  const missing = yield* Effect.result(commandFromConfig('BRIDGE').pipe(Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnvRecord({}))));
  assert.strictEqual(missing._tag, 'Failure');
  const provider = ConfigProvider.fromEnvRecord({ BRIDGE: '["printf","%s","$(false); literal"]' });
  const run = yield* commandFromConfig('BRIDGE').pipe(Effect.provideService(ConfigProvider.ConfigProvider, provider));
  assert.strictEqual(yield* run, 'Bridge exécuté.');
})).pipe(Effect.provide(NodeServices.layer)));
