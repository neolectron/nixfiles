import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { identity } from "../src/lifetime.js";

const guardPath = fileURLToPath(new URL("../src/guard.js", import.meta.url));
async function guard(ttl = 5, extras = {}) {
  const child = spawn(process.execPath, [guardPath, JSON.stringify({ ttl_seconds: ttl, parent: identity(process.pid), ...extras })], { stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout });
  const exited = once(child, "close");
  const ready = await Promise.race([once(lines, "line"), exited.then(() => { throw new Error("guard exited before ready"); })]);
  assert.equal(JSON.parse(String(ready[0])).ready, true);
  return { child, lines, exited };
}
const dummy = () => spawn(process.execPath, ["-e", "process.stdin.resume()"], { stdio: ["pipe", "ignore", "ignore"] });

test("guard expires with idle stdin (no logind calls)", { timeout: 3000 }, async () => {
  const { child, exited } = await guard(1);
  assert.equal((await exited)[0], 0);
  child.stdin.destroy();
});

test("EOF releases the guard immediately", { timeout: 2000 }, async () => {
  const { child, exited } = await guard();
  child.stdin.end();
  assert.equal((await exited)[0], 0);
});

test("explicit renewal gets an acknowledgement and invalid renewal exits", { timeout: 2000 }, async () => {
  const { child, lines, exited } = await guard();
  const reply = once(lines, "line");
  child.stdin.write('{"id":7,"ttl_seconds":10}\n');
  assert.equal(JSON.parse(String((await reply)[0])).id, 7);
  child.stdin.write('{"id":8,"ttl_seconds":0}\n');
  assert.equal((await exited)[0], 1);
});

test("guard notices task exit, without any signal from the guard", { timeout: 2000 }, async () => {
  const task = dummy();
  try {
    const { child, exited } = await guard(5, { task: identity(task.pid!) });
    const taskExit = once(task, "close");
    task.stdin.end();
    await taskExit;
    assert.equal((await exited)[0], 0);
    child.stdin.destroy();
  } finally { if (task.exitCode === null) task.kill(); }
});

test("crashed parent ends only its guard", { timeout: 2000 }, async () => {
  const parent = dummy();
  try {
    const { child, exited } = await guard(5, { parent: identity(parent.pid!) });
    parent.kill("SIGKILL");
    assert.equal((await exited)[0], 0);
    child.stdin.destroy();
  } finally { if (parent.exitCode === null) parent.kill(); }
});

test("independent guard deadline still expires with frozen parent", { timeout: 3000 }, async () => {
  const parent = dummy();
  try {
    const { child, exited } = await guard(1, { parent: identity(parent.pid!) });
    parent.kill("SIGSTOP");
    assert.equal((await exited)[0], 0);
    child.stdin.destroy();
  } finally { parent.kill("SIGKILL"); }
});
