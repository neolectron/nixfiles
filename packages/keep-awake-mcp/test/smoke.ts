// Opt-in real logind integration via the official MCP client. Every signal
// below targets only a test server/task we just created, never an existing app.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { SystemdBackend, type Inhibitor } from "../src/backend.js";

const command = process.argv[2] ?? process.execPath;
const args = process.argv[2] ? process.argv.slice(3) : [fileURLToPath(new URL("../src/server.js", import.meta.url))];
const observer = new SystemdBackend();
const prefix = "smoke-" + randomUUID();
const clients: { client: Client; transport: StdioClientTransport }[] = [];

async function start() {
  const client = new Client({ name: "keep-awake-smoke", version: "1.0.0" });
  const transport = new StdioClientTransport({ command, args });
  clients.push({ client, transport });
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 4);
  return { client, transport };
}
async function call<T = Record<string, unknown>>(client: Client, name: string, args = {}): Promise<T> {
  const result = await client.callTool({ name: `keep_awake_${name}`, arguments: args });
  assert(!result.isError, JSON.stringify(result));
  const content = result.content[0];
  assert(content?.type === "text");
  return JSON.parse(content.text) as T;
}
const owned = async () => (await observer.list()).filter(row => row.who.startsWith("keep-awake-mcp:" + prefix));
async function wait(predicate: () => Promise<boolean>, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for inhibitor cleanup");
}
async function acquire(client: Client, suffix: string, ttl_seconds = 5, extras = {}) {
  const lease = await call<{ lease_id: string }>(client, "acquire", { task_id: prefix + suffix, reason: "temporary safe integration smoke", ttl_seconds, ...extras });
  assert((await owned()).some(row => row.who === "keep-awake-mcp:" + prefix + suffix && row.what === "sleep:idle" && row.mode === "block"));
  return lease.lease_id;
}
const key = (row: Inhibitor) => JSON.stringify([row.who, row.pid, row.what, row.mode]);

const baseline = await observer.list();
try {
  const one = await start(), two = await start();
  const first = await acquire(one.client, "-one"), second = await acquire(one.client, "-two");
  assert.equal((await owned()).length, 2);
  assert.equal((await call(two.client, "release", { lease_id: first })).released, false);
  assert.equal((await owned()).length, 2);
  assert.equal((await call(one.client, "release", { lease_id: first })).released, true);
  await wait(async () => (await owned()).length === 1);
  await call(one.client, "renew", { lease_id: second, ttl_seconds: 1 });
  await wait(async () => !(await owned()).length);
  assert.equal((await call(one.client, "status")).session_inhibited, false);
  console.log("PASS: official SDK handshake/tools, acquisition, independent release, cross-session isolation, renewal and idle-input expiry");

  await acquire(one.client, "-eof");
  await one.client.close();
  await wait(async () => !(await owned()).length);
  console.log("PASS: client connection close/EOF cleanup");

  await acquire(two.client, "-crash");
  assert(two.transport.pid);
  process.kill(two.transport.pid, "SIGKILL");
  await wait(async () => !(await owned()).length);
  console.log("PASS: crashed MCP parent releases all its CLI-held locks");

  const three = await start();
  const task = spawn(process.execPath, ["-e", "process.stdin.resume()"], { stdio: ["pipe", "ignore", "ignore"] });
  try {
    await acquire(three.client, "-task", 5, { task_pid: task.pid });
    const exited = once(task, "close");
    task.stdin.end();
    await exited;
    await wait(async () => !(await owned()).length);
    console.log("PASS: exact local task process exit cleanup");
  } finally { if (task.exitCode === null) task.kill("SIGKILL"); }

  await acquire(three.client, "-frozen", 1);
  assert(three.transport.pid);
  process.kill(three.transport.pid, "SIGSTOP");
  try { await wait(async () => !(await owned()).length); }
  finally { process.kill(three.transport.pid, "SIGCONT"); }
  console.log("PASS: guard deadline releases inhibition even while MCP parent is frozen");

  await acquire(three.client, "-term");
  process.kill(three.transport.pid, "SIGTERM");
  await wait(async () => !(await owned()).length);
  const after = new Set((await observer.list()).map(key));
  assert(baseline.every(row => after.has(key(row))), "An external inhibitor changed during smoke; inspect separately");
  console.log(`PASS: SIGTERM cleanup; all ${baseline.length} existing inhibitors remain; no test inhibitors left`);
} finally {
  await Promise.allSettled(clients.map(({ client }) => client.close()));
  await wait(async () => !(await owned()).length);
}
