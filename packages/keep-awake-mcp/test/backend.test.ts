import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SystemdBackend } from "../src/backend.js";

async function fakeCli() {
  const directory = await mkdtemp(join(tmpdir(), "keep-awake-cli-mock-"));
  const command = join(directory, "mock-systemd-inhibit");
  const record = join(directory, "argv.json");
  await writeFile(command, `#!${process.execPath}
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const args=process.argv.slice(2);
writeFileSync(${JSON.stringify(record)},JSON.stringify(args));
if(args.includes('--list')) {console.log(JSON.stringify([{who:'other-app',what:'sleep',mode:'block',pid:1}]));}
else {const index=args.indexOf('--');const child=spawn(args[index+1],args.slice(index+2),{stdio:'inherit'});child.on('close',code=>process.exit(code??1));}
`, { mode: 0o700 });
  return { directory, command, record };
}

test("CLI adapter uses literal argument arrays, waits for lock readiness and releases by EOF", { timeout: 3000 }, async () => {
  const mock = await fakeCli();
  const backend = new SystemdBackend(mock.command);
  try {
    const reason = 'literal $(touch /tmp/never-run) `echo no` ; --shell';
    const held = await backend.acquire("local-task", reason, 10);
    const args: string[] = JSON.parse(await readFile(mock.record, "utf8"));
    assert.deepEqual(args.slice(0, 6), ["--no-ask-password", "--what=sleep:idle", "--mode=block", "--who=keep-awake-mcp:local-task", `--why=${reason}`, "--"]);
    assert(held.running);
    const before = held.deadline;
    assert((await held.renew(15)) > before);
    await held.release();
    assert(!held.running);
    assert.deepEqual((await backend.list()).map(row => row.who), ["other-app"]);
  } finally { await rm(mock.directory, { recursive: true, force: true }); }
});

test("failed CLI spawn never returns an apparently active inhibitor", { timeout: 2000 }, async () => {
  const backend = new SystemdBackend("/nonexistent/keep-awake-test-command");
  await assert.rejects(backend.acquire("test", "test", 1), /ENOENT/);
});

test("stuck CLI readiness is bounded and terminates only its own process", { timeout: 7000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "keep-awake-timeout-mock-"));
  const command = join(directory, "mock-inhibit");
  const pidfile = join(directory, "test-pid");
  await writeFile(command, `#!${process.execPath}
import {writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(pidfile)},String(process.pid));
process.on('SIGTERM',()=>{});process.stdin.resume();setInterval(()=>{},1000);
`, { mode: 0o700 });
  try {
    const backend = new SystemdBackend(command);
    await assert.rejects(backend.acquire("test", "test", 1), /five seconds/);
    const pid = Number(await readFile(pidfile, "utf8"));
    await assert.rejects(readFile(`/proc/${pid}/stat`, "utf8"), { code: "ENOENT" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
