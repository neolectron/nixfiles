import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MockDeck, mockButton, mockEncoder, mockInfo, demoEvents } from '../src/mock.js';
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

test('optional LCD display uses detected XL dimensions and serializes key and LCD writes', async () => {
  const deck = new MockDeck({ ...mockInfo, controls: mockInfo.controls.map((control) => (
    control.type === 'button' ? { ...control, pixelSize: { width: 112, height: 112 } } :
    control.type === 'lcd-segment' ? { ...control, pixelSize: { width: 1200, height: 100 } } : control
  )) });
  const order: string[] = [];
  let active = 0;
  let maxActive = 0;
  for (const method of ['paintKey', 'paintLcd'] as const) {
    const write = deck[method].bind(deck);
    deck[method] = async (index, rgb) => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      await write(index, rgb); order.push(method); active--;
    };
  }
  const logs: { kind?: string; target?: string }[] = [];
  const session = startSession(deck, true, (event) => logs.push(event as typeof logs[number]), (error) => { throw error; }, true);
  await session.flush();
  const initial = deck.lcdFrames[0]!.rgb;
  deck.emit({ kind: 'down', control: mockButton });
  deck.emit({ kind: 'rotate', control: mockEncoder, amount: 5 });
  await session.stop();
  assert.equal(maxActive, 1);
  assert.deepEqual(order, ['paintKey', 'paintLcd', 'paintKey', 'paintLcd', 'paintKey', 'paintLcd']);
  assert.ok(deck.frames.every((frame) => frame.index === 0 && frame.rgb.length === 112 * 112 * 3));
  assert.ok(deck.lcdFrames.every((frame) => frame.index === 0 && frame.rgb.length === 1200 * 100 * 3));
  assert.notDeepEqual(initial, deck.lcdFrames[1]!.rgb);
  assert.notDeepEqual(deck.lcdFrames[1]!.rgb, deck.lcdFrames[2]!.rgb);
  assert.equal(logs.filter((event) => event.kind === 'display-written' && event.target === 'lcd').length, 3);
  await deck.close();
});

test('LCD stays untouched by default and unsupported LCD requests fail before painting', async () => {
  const deck = new MockDeck();
  const session = startSession(deck, true, () => {}, (error) => { throw error; });
  await session.flush(); await session.stop();
  assert.equal(deck.lcdFrames.length, 0);
  const withoutLcd = new MockDeck({ ...mockInfo, controls: [mockButton] });
  assert.throws(() => startSession(withoutLcd, true, () => {}, () => {}, true), /bande LCD/);
  assert.equal(withoutLcd.frames.length, 0);
  assert.throws(() => startSession(deck, false, () => {}, () => {}, true), /exige le mode hello/);
  await deck.close(); await withoutLcd.close();
});

test('LCD write failures reach the failure handler without claiming a successful LCD write', async () => {
  const deck = new MockDeck();
  const failure = new Error('LCD disconnected');
  deck.paintLcd = async () => { throw failure; };
  const errors: unknown[] = [];
  const logs: unknown[] = [];
  const session = startSession(deck, true, (event) => logs.push(event), (error) => errors.push(error), true);
  await session.flush();
  assert.deepEqual(errors, [failure]);
  assert.equal(logs.filter((event) => (event as { target?: string }).target === 'lcd').length, 0);
  await session.stop(); await deck.close();
});

test('CLI LCD demo draws the band and refuses LCD writes outside hello before HID discovery', () => {
  const demo = cli('hello', '--lcd', '--mock', '--demo');
  assert.equal(demo.status, 0, demo.stderr);
  assert.equal(demo.stdout.match(/"target":"lcd"/g)?.length, 5);
  const forbidden = cli('events', '--lcd');
  assert.equal(forbidden.status, 1);
  assert.match(forbidden.stderr, /--lcd exige hello/);
});
