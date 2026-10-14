import { assert, it } from '@effect/vitest';
import { NodeServices, NodeSocketServer } from '@effect/platform-node';
import { ConfigProvider, Deferred, Effect, Fiber, FileSystem, Layer, Redacted } from 'effect';
import { authorize, DiscordOAuth, make } from '../src/discord-connection.ts';
import { Decoder, DiscordTransport, encode } from '../src/discord-ipc.ts';
import { IntegrationError, type Message } from '../src/json-socket.ts';

const transport = (denied = false) => {
  const sent: Array<Message> = []; let closed = 0;
  const layer = Layer.succeed(DiscordTransport, { connect: (clientId, receive) => Effect.gen(function*() {
    assert.strictEqual(clientId, '123456');
    yield* Effect.addFinalizer(() => Effect.sync(() => { closed++; })); yield* receive({ evt: 'READY' });
    return { failure: Effect.never, send: (message: Message) => Effect.gen(function*() {
      sent.push(message); yield* receive({ nonce: message.nonce, ...(denied ? { evt: 'ERROR', data: { message: 'DO NOT EXPOSE' } } : { data: { code: 'temporary-code' } }) });
    }) };
  }) });
  return { layer, sent, closed: () => closed };
};

it.effect('IPC decodes split/coalesced frames and bounds frame lengths', () => Effect.sync(() => {
  const a = encode(1, { evt: 'READY', data: { label: 'é' } }); const b = encode(3, { ping: 42 });
  const bytes = new Uint8Array(a.length + b.length); bytes.set(a); bytes.set(b, a.length);
  for (let split = 1; split < bytes.length; split++) {
    const decoder = new Decoder(); const frames = [...decoder.push(bytes.slice(0, split)), ...decoder.push(bytes.slice(split))];
    assert.deepStrictEqual(frames, [{ opcode: 1, message: { evt: 'READY', data: { label: 'é' } } }, { opcode: 3, message: { ping: 42 } }]);
  }
  const header = new Uint8Array(8); new DataView(header.buffer).setUint32(4, 1024 * 1024 + 1, true);
  assert.throws(() => new Decoder().push(header), IntegrationError);
}));

it.live('authorization is interactive, scoped and only requests rpc/identify', () => Effect.gen(function*() {
  const fake = transport(); assert.strictEqual(yield* authorize('123456').pipe(Effect.provide(fake.layer)), 'temporary-code');
  assert.deepStrictEqual(fake.sent[0]!.args, { client_id: '123456', scopes: ['rpc', 'identify'] }); assert.strictEqual(fake.closed(), 1);
  const denied = transport(true); const result = yield* Effect.result(authorize('123456').pipe(Effect.provide(denied.layer)));
  assert.strictEqual(result._tag, 'Failure'); assert.strictEqual(denied.closed(), 1);
  if (result._tag === 'Failure') assert.ok(!result.failure.message.includes('DO NOT EXPOSE'));
}).pipe(Effect.provide(NodeServices.layer)));

it.live('native IPC sends a handshake, handles fragmented READY and answers PING before scoped authorization closes', () => Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem; const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'discord-ipc-' }); const file = `${directory}/discord-ipc-0`;
  const server = yield* NodeSocketServer.make({ path: file }); const pong = yield* Deferred.make<void>();
  const fiber = yield* Effect.forkScoped(server.run((socket) => Effect.gen(function*() {
    const reader = yield* socket.reader; const writer = yield* socket.writer; const decoder = new Decoder();
    yield* Effect.forever(Effect.gen(function*() {
      for (const chunk of yield* reader.pull) for (const frame of decoder.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk)) {
        if (frame.opcode === 0) {
          assert.deepStrictEqual(frame.message, { v: 1, client_id: '123456' });
          const ready = encode(1, { evt: 'READY' }); yield* writer.write(ready.slice(0, 3)); yield* writer.write(ready.slice(3)); yield* writer.write(encode(3, { ping: 42 }));
        } else if (frame.opcode === 4) { assert.deepStrictEqual(frame.message, { ping: 42 }); yield* Deferred.succeed(pong, undefined); }
        else if (frame.message.cmd === 'AUTHORIZE') yield* writer.write(encode(1, { nonce: frame.message.nonce, data: { code: 'native-code' } }));
      }
    }));
  }).pipe(Effect.scoped, Effect.ignore)));
  const code = yield* authorize('123456').pipe(Effect.provide(DiscordTransport.layer), Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnvRecord({ STREAMDECK_DISCORD_IPC_PATH: file })));
  assert.strictEqual(code, 'native-code'); yield* Deferred.await(pong); yield* Fiber.interrupt(fiber);
})).pipe(Effect.provide(NodeServices.layer), Effect.timeout('3 seconds')));

it.live('private OAuth config persists securely, refreshes tokens and never includes secrets in public state', () => Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem; const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'discord-oauth-' }); const file = `${directory}/profile.discord-connection.json`;
  const fake = transport(); const grants: Array<'code' | 'refresh'> = [];
  const oauth = Layer.succeed(DiscordOAuth, { exchange: (clientId, secret, grant) => Effect.sync(() => {
    assert.strictEqual(clientId, '123456'); assert.strictEqual(Redacted.value(secret), 'private-secret');
    grants.push('code' in grant ? 'code' : 'refresh');
    return { access_token: grants.length === 1 ? 'first-access' : 'new-access', refresh_token: 'private-refresh', expires_in: grants.length === 1 ? 1 : 3600 };
  }) });
  const store = yield* make(file);
  assert.strictEqual(yield* store.options.pipe(Effect.provide(oauth)), undefined);
  yield* store.configure({ clientId: '123456', clientSecret: 'private-secret' }); assert.strictEqual((yield* Effect.result(store.options.pipe(Effect.provide(oauth))))._tag, 'Failure');
  yield* store.connect.pipe(Effect.provide(Layer.mergeAll(fake.layer, oauth)));
  assert.deepStrictEqual(yield* store.publicState, { clientId: '123456', configured: true, authorized: true });
  assert.strictEqual((yield* fs.stat(file)).mode & 0o777, 0o600); assert.deepStrictEqual(yield* fs.readDirectory(directory), ['profile.discord-connection.json']);
  const reloaded = yield* make(file); const options = yield* reloaded.options.pipe(Effect.provide(oauth));
  assert.ok(options); assert.strictEqual(Redacted.value(options!.accessToken), 'new-access'); assert.deepStrictEqual(grants, ['code', 'refresh']);
  yield* reloaded.configure({ clientId: '123456' }); assert.strictEqual((yield* reloaded.publicState).authorized, false);
  assert.strictEqual((yield* Effect.result(reloaded.configure({ clientId: '654321' })))._tag, 'Failure');
})).pipe(Effect.provide(NodeServices.layer)));

it.live('IPC discovery fails clearly without dialing unrelated sockets', () => Effect.scoped(Effect.gen(function*() {
  const api = yield* DiscordTransport;
  const result = yield* Effect.result(api.connect('123456', () => Effect.void));
  assert.strictEqual(result._tag, 'Failure'); if (result._tag === 'Failure') assert.ok(result.failure.message.includes('Socket Discord introuvable'));
})).pipe(Effect.provide(DiscordTransport.layer), Effect.provide(NodeServices.layer), Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnvRecord({ STREAMDECK_DISCORD_IPC_PATH: '/does-not-exist/discord-ipc' }))));
