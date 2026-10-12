import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type { Backend, HeldLease, Inhibitor } from "../src/backend.js";
import { Leases } from "../src/leases.js";
import { identity, alive, ttl, MAX_TTL, type ProcessIdentity } from "../src/lifetime.js";

class FakeHeld extends EventEmitter implements HeldLease {
  running = true;
  deadline: number;
  constructor(seconds: number, private readonly clock: () => number) {
    super(); this.deadline = clock() + seconds * 1000;
  }
  async renew(seconds: number) { this.deadline = this.clock() + seconds * 1000; return this.deadline; }
  async release() { this.running = false; this.emit("exit"); }
  onExit(callback: () => void) { this.once("exit", callback); }
}
class FakeBackend implements Backend {
  calls: { taskId: string; reason: string; task?: ProcessIdentity }[] = [];
  held: FakeHeld[] = [];
  external: Inhibitor = { who: "other-app", what: "sleep", mode: "block", pid: 1 };
  constructor(readonly clock: () => number) {}
  async acquire(taskId: string, reason: string, seconds: number, task?: ProcessIdentity) {
    this.calls.push({ taskId, reason, task });
    const held = new FakeHeld(seconds, this.clock);
    this.held.push(held);
    return held;
  }
  async list() { return [this.external]; }
}
function setup() {
  let time = 100_000;
  const now = () => time;
  const backend = new FakeBackend(now);
  const manager = new Leases(backend, now);
  const acquire = (task_id = "one", ttl_seconds = 10) => manager.acquire({ task_id, reason: "safe test", ttl_seconds });
  return { backend, manager, acquire, advance: (seconds: number) => { time += seconds * 1000; } };
}

test("independent leases, idempotent release and other app preservation", async () => {
  const { manager, acquire, backend } = setup();
  const one = await acquire("one"), two = await acquire("two");
  assert.equal((await manager.release(one.lease_id)).released, true);
  assert.equal((await manager.release(one.lease_id)).released, false);
  assert.deepEqual((await manager.status()).session_leases.map(lease => lease.lease_id), [two.lease_id]);
  assert.deepEqual((await manager.status()).system_inhibitors, [backend.external]);
  await manager.close();
});

test("foreign MCP session cannot release or renew another session's lease", async () => {
  const { manager, acquire, backend } = setup();
  const other = new Leases(backend);
  const one = await acquire();
  assert.equal((await other.release(one.lease_id)).released, false);
  await assert.rejects(other.renew(one.lease_id), /not active/);
  assert.equal((await manager.status()).session_leases.length, 1);
  await manager.close(); await other.close();
});

test("explicit renewal is bounded, expiry cannot be resurrected", async () => {
  const { manager, acquire, advance, backend } = setup();
  const one = await acquire();
  advance(5);
  assert.equal((await manager.renew(one.lease_id, 20)).remaining_seconds, 20);
  advance(20);
  await assert.rejects(manager.renew(one.lease_id, 10), /not active/);
  assert.equal((await manager.status()).session_inhibited, false);
  await backend.held[0]!.release();
  assert.equal((await manager.release(one.lease_id)).released, false);
});

test("invalid TTL, text and PID never reaches inhibition backend", async () => {
  const { manager, backend } = setup();
  for (const value of [0, -1, MAX_TTL + 1, NaN, Infinity, 1.1]) {
    await assert.rejects(manager.acquire({ task_id: "test", reason: "test", ttl_seconds: value }));
  }
  for (const task_id of ["", " ", "bad\n", "bad\0", "x".repeat(129)]) {
    await assert.rejects(manager.acquire({ task_id, reason: "test" }));
  }
  await assert.rejects(manager.acquire({ task_id: "test", reason: "x".repeat(513) }));
  await assert.rejects(manager.acquire({ task_id: "test", reason: "test", task_pid: -1 }));
  assert.equal(backend.calls.length, 0);
  assert.throws(() => ttl("2" as unknown as number));
});

test("40 concurrent task acquisitions/releases preserve independent ownership", async () => {
  const { manager, acquire, backend } = setup();
  const tasks = await Promise.all(Array.from({ length: 40 }, (_, index) => acquire(String(index))));
  assert.equal((await manager.status()).session_leases.length, 40);
  await Promise.all(tasks.map(task => manager.release(task.lease_id)));
  assert.equal(backend.held.filter(lease => lease.running).length, 0);
  assert.equal((await manager.status()).session_inhibited, false);
});

test("duplicate concurrent task ID creates only one inhibitor", async () => {
  const { manager, acquire, backend } = setup();
  const outcomes = await Promise.allSettled([acquire(), acquire()]);
  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(backend.calls.length, 1);
  await manager.close();
});

test("lease cap includes pending requests", async () => {
  const { manager, acquire } = setup();
  const outcomes = await Promise.allSettled(Array.from({ length: 65 }, (_, index) => acquire(String(index))));
  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 64);
  await manager.close();
});

test("backend acquisition failure does not leak a task reservation", async () => {
  const { manager, acquire, backend } = setup();
  const original = backend.acquire.bind(backend);
  backend.acquire = async () => { throw new Error("permission denied"); };
  await assert.rejects(acquire(), /permission denied/);
  backend.acquire = original;
  await acquire();
  await manager.close();
});

test("backend exit removes lost inhibitors, close releases only owned leases", async () => {
  const { manager, acquire, backend } = setup();
  await acquire("one"); await acquire("two");
  await backend.held[0]!.release();
  assert.equal((await manager.status()).session_leases.length, 1);
  await manager.close(); await manager.close();
  assert(backend.held.every(lease => !lease.running));
  await assert.rejects(acquire("three"), /shutting down/);
});

test("read-only status reports backend failure without clearing active leases", async () => {
  const { manager, acquire, backend } = setup();
  await acquire();
  backend.list = async () => { throw new Error("offline"); };
  const status = await manager.status();
  assert.equal(status.session_inhibited, true);
  assert.equal(status.system_status_error, "offline");
  await manager.close();
});

test("local PID identity rejects reuse and zombies without signalling processes", () => {
  const current = identity(process.pid);
  assert(alive(current));
  assert(!alive({ ...current, start: "not-the-same-process" }));
  assert(!alive({ ...current, uid: current.uid + 1 }));
  assert(!alive({ ...current, pid: -1 }));
});

test("real local PID is passed as an exact identity to the backend", async () => {
  const { manager, backend } = setup();
  await manager.acquire({ task_id: "test", reason: "local task", task_pid: process.pid });
  assert.deepEqual(backend.calls[0]!.task, identity(process.pid));
  await manager.close();
});
