import { assert, it } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem } from 'effect';
import * as Mock from '../src/mock.ts';
import * as Actions from '../src/studio-actions.ts';
import { StreamDeck } from '../src/stream-deck.ts';

const counter = (label: string, start = 0) => ({ label, action: 'counter' as const, parameters: { start } });
const setup = (run: (actions: Effect.Success<ReturnType<typeof Actions.make>>, file: string) => Effect.Effect<void, unknown, FileSystem.FileSystem>) => Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem; const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-rearrange-' }); const file = `${directory}/profile.json`; const mock = Mock.make();
  yield* Effect.gen(function*() { yield* run(yield* Actions.make(yield* StreamDeck, file, []), file); }).pipe(Effect.provide(mock.layer()));
})).pipe(Effect.provide(NodeServices.layer));
const exchange = (actions: Effect.Success<ReturnType<typeof Actions.make>>, source: number, target: number) => Effect.gen(function*() {
  const view = yield* actions.view;
  return yield* actions.organize({ operation: 'exchange', source, target, sourceAddress: view.keys.get(source)!.address, targetAddress: view.keys.get(target)!.address, revision: view.layout.revision });
});

it.live('moving to a free slot and exchanging across zones preserves identity, counter state and saved bindings', () => setup((actions, file) => Effect.gen(function*() {
  yield* actions.save(0, counter('A', 5)); yield* actions.save(10, counter('B', 9)); yield* actions.press(0);
  const a = (yield* actions.view).keys.get(0)!.entry!.id; const b = (yield* actions.view).keys.get(10)!.entry!.id;
  yield* actions.organize({ operation: 'create-zone', name: 'Apps', keys: [0, 1, 2], revision: (yield* actions.view).layout.revision });
  yield* exchange(actions, 0, 1); let view = yield* actions.view;
  assert.strictEqual(view.keys.get(0)!.entry, null); assert.strictEqual(view.keys.get(1)!.entry!.id, a); assert.strictEqual(view.keys.get(1)!.state.count, 6);
  yield* exchange(actions, 1, 10); view = yield* actions.view;
  assert.strictEqual(view.keys.get(1)!.entry!.id, b); assert.strictEqual(view.keys.get(10)!.entry!.id, a); assert.strictEqual(view.keys.get(10)!.state.count, 6);
  const saved = JSON.parse(yield* (yield* FileSystem.FileSystem).readFileString(file));
  assert.strictEqual(saved.zones.find((zone: { id: string }) => zone.id === 'deck').items[7].id, a);
  assert.strictEqual(saved.zones.find((zone: { id: string }) => zone.id !== 'deck').items[1].id, b);
})));

it.live('rearranging one page keeps hidden pages and folder contents intact; virtual Return is protected', () => setup((actions, file) => Effect.gen(function*() {
  yield* actions.organize({ operation: 'create-zone', name: 'Apps', keys: [0, 1, 2], revision: (yield* actions.view).layout.revision });
  const zone = (yield* actions.profile).zones.find((zone) => zone.id !== 'deck')!.id;
  yield* actions.save(0, counter('Hidden')); const hidden = (yield* actions.view).keys.get(0)!.entry!.id;
  yield* actions.organize({ operation: 'add-page', zone, revision: (yield* actions.view).layout.revision });
  yield* actions.save(1, counter('Page 2')); const visible = (yield* actions.view).keys.get(1)!.entry!.id;
  yield* exchange(actions, 1, 2); assert.strictEqual((yield* actions.view).keys.get(2)!.entry!.id, visible);
  yield* actions.navigate({ zone, operation: 'previous' }); assert.strictEqual((yield* actions.view).keys.get(0)!.entry!.id, hidden);
  yield* actions.organize({ operation: 'create-folder', key: 1, name: 'Tools', address: (yield* actions.view).keys.get(1)!.address });
  yield* actions.press(1); yield* actions.save(1, counter('In folder')); const child = (yield* actions.view).keys.get(1)!.entry!.id;
  yield* exchange(actions, 1, 2); assert.strictEqual((yield* actions.view).keys.get(2)!.entry!.id, child);
  const fs = yield* FileSystem.FileSystem; const before = yield* fs.readFileString(file);
  assert.strictEqual((yield* Effect.result(exchange(actions, 2, 0)))._tag, 'Failure'); assert.strictEqual(yield* fs.readFileString(file), before);
  yield* actions.navigate({ zone, operation: 'back' }); assert.strictEqual((yield* actions.view).keys.get(0)!.entry!.id, hidden);
})));

it.live('moving a fixed pager within its zone retains its pin and every other page entry', () => setup((actions) => Effect.gen(function*() {
  yield* actions.save(0, counter('Fixed')); const fixed = (yield* actions.view).keys.get(0)!.entry!.id;
  yield* actions.organize({ operation: 'pin', key: 0, value: true, address: (yield* actions.view).keys.get(0)!.address });
  yield* actions.save(1, counter('Page 1')); const first = (yield* actions.view).keys.get(1)!.entry!.id;
  yield* actions.organize({ operation: 'add-page', zone: 'deck', revision: (yield* actions.view).layout.revision });
  yield* actions.save(2, counter('Page 2')); const second = (yield* actions.view).keys.get(2)!.entry!.id;
  yield* exchange(actions, 0, 1); let view = yield* actions.view;
  assert.strictEqual(view.keys.get(1)!.entry!.id, fixed); assert.strictEqual(view.keys.get(1)!.pinned, true); assert.strictEqual(view.keys.get(2)!.entry!.id, second);
  yield* actions.navigate({ zone: 'deck', operation: 'previous' }); view = yield* actions.view;
  assert.strictEqual(view.keys.get(0)!.entry!.id, first); assert.strictEqual(view.keys.get(1)!.entry!.id, fixed);
  yield* exchange(actions, 1, 2); view = yield* actions.view;
  assert.strictEqual(view.keys.get(2)!.entry!.id, fixed); assert.strictEqual(view.keys.get(2)!.pinned, true);
})));

it.live('stale drag addresses and revisions never overwrite a changed layout', () => setup((actions, file) => Effect.gen(function*() {
  yield* actions.save(0, counter('A')); const old = yield* actions.view;
  yield* actions.save(1, counter('Changed')); const current = yield* actions.view;
  const fs = yield* FileSystem.FileSystem; const before = yield* fs.readFileString(file);
  const command = { operation: 'exchange' as const, source: 0, target: 1, sourceAddress: old.keys.get(0)!.address, targetAddress: old.keys.get(1)!.address, revision: old.layout.revision };
  assert.strictEqual((yield* Effect.result(actions.organize(command)))._tag, 'Failure');
  assert.strictEqual((yield* Effect.result(actions.organize({ ...command, revision: current.layout.revision })))._tag, 'Failure');
  assert.strictEqual(yield* fs.readFileString(file), before);
})));
