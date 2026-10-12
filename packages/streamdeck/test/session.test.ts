import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MockDeck, mockButton, mockEncoder, demoEvents } from '../src/mock.js';
import { startSession } from '../src/session.js';
import { selectDevice } from '../src/transport.js';

test('hello displays only the first LCD key, responds to button/encoder input, and cleans up', async () => {
  const deck = new MockDeck();
  const logs: unknown[] = [];
  const session = startSession(deck, true, (event) => logs.push(event), (error) => { throw error; });
  await session.flush();
  const initial = deck.frames[0]!.rgb;
  deck.emit({ kind: 'down', control: mockButton });
  await session.flush();
  assert.notDeepEqual(deck.frames[1]!.rgb, initial);
  deck.emit({ kind: 'up', control: mockButton });
  await session.flush();
  assert.deepEqual(deck.frames[2]!.rgb, initial);
  for (const event of demoEvents.slice(2)) deck.emit(event);
  await session.flush();
  assert.equal(session.level, 51);
  assert.equal(deck.frames.length, 5);
  assert.ok(deck.frames.every((frame) => frame.index === 0 && frame.rgb.length === 120 * 120 * 3));
  assert.ok(logs.some((entry) => (entry as { kind: string }).kind === 'touch'));
  await session.stop();
  deck.emit({ kind: 'down', control: mockButton });
  assert.equal(deck.frames.length, 5);
  await deck.close();
  assert.equal(deck.closed, true);
});

test('simulated rotary level clamps to 0..100; other button indices do not redraw', async () => {
  const deck = new MockDeck();
  const session = startSession(deck, true, () => {}, (error) => { throw error; });
  await session.flush();
  deck.emit({ kind: 'down', control: { ...mockButton, index: 1 } });
  await session.flush();
  assert.equal(deck.frames.length, 1);
  deck.emit({ kind: 'rotate', control: mockEncoder, amount: 1000 });
  assert.equal(session.level, 100);
  deck.emit({ kind: 'rotate', control: mockEncoder, amount: -1000 });
  assert.equal(session.level, 0);
  await session.stop(); await deck.close();
});

test('events works for a device without an LCD, and never writes display frames', async () => {
  const deck = new MockDeck({ path: 'mock://pedal', model: 'Mock Pedal', controls: [{ type: 'button', index: 0, feedbackType: 'none' }] });
  assert.throws(() => startSession(deck, true, () => {}, () => {}), /touche LCD/);
  const logs: unknown[] = [];
  const session = startSession(deck, false, (event) => logs.push(event), () => {});
  deck.emit({ kind: 'down', control: deck.info.controls[0]! });
  await session.stop();
  assert.equal(logs.length, 1);
  assert.equal(deck.frames.length, 0);
  await deck.close();
});

test('device choice rejects ambiguity and stale paths instead of opening the wrong device', () => {
  const first = new MockDeck().info;
  const second = { ...first, path: 'mock://second' };
  assert.throws(() => selectDevice([]), /Aucun Stream Deck/);
  assert.throws(() => selectDevice([first, second]), /Plusieurs/);
  assert.throws(() => selectDevice([first], '/dev/missing'), /introuvable/);
  assert.equal(selectDevice([first, second], second.path), second);
});

test('HID read and write failures reach the session failure handler', async () => {
  const deck = new MockDeck();
  const errors: unknown[] = [];
  const failure = new Error('USB disconnected');
  deck.paintKey = async () => { throw failure; };
  const session = startSession(deck, true, () => {}, (error) => errors.push(error));
  await session.flush();
  deck.emit({ kind: 'error', error: failure });
  assert.deepEqual(errors, [failure, failure]);
  await session.stop(); await deck.close();
});

test('asynchronous display writes are serialized, including during shutdown', async () => {
  const deck = new MockDeck();
  const original = deck.paintKey.bind(deck);
  let active = 0;
  let maxActive = 0;
  deck.paintKey = async (index, rgb) => {
    active++; maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await original(index, rgb); active--;
  };
  const session = startSession(deck, true, () => {}, (error) => { throw error; });
  for (let i = 0; i < 8; i++) deck.emit({ kind: 'rotate', control: mockEncoder, amount: 1 });
  await session.stop(); await deck.close();
  assert.equal(maxActive, 1);
  assert.equal(deck.frames.length, 9);
});

const cli = (...args: string[]) => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 5000,
  });
  assert.ifError(result.error);
  return result;
};

test('CLI hello mock runs without native HID loading and exits with five frames', () => {
  const result = cli('hello', '--mock', '--demo');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"kind":"demo-complete","frames":5,"level":51/);
  assert.doesNotMatch(result.stderr, /libudev|HID/);
});

test('CLI events mock produces no frames and bounded listening exits', () => {
  const result = cli('events', '--mock', '--demo');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"kind":"demo-complete","frames":0,"level":51/);
  const timed = cli('events', '--mock', '--duration', '0.02');
  assert.equal(timed.status, 0, timed.stderr);
});

test('CLI refuses real-device demo and invalid duration before native discovery', () => {
  const realDemo = cli('hello', '--demo');
  assert.equal(realDemo.status, 1);
  assert.match(realDemo.stderr, /--demo exige --mock/);
  const invalidDuration = cli('events', '--mock', '--duration', 'NaN');
  assert.equal(invalidDuration.status, 1);
  assert.match(invalidDuration.stderr, /--duration doit/);
});
