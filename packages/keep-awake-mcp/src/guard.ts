// Executed only under systemd-inhibit. Its own finite timer survives a frozen
// MCP parent. EOF, parent/task exit and explicit release end this child, which
// makes systemd-inhibit close only the lock acquired for this lease.
import { createInterface } from "node:readline";
import { alive, bootTimeMs, ttl, type ProcessIdentity } from "./lifetime.js";

interface Config { ttl_seconds: number; parent: ProcessIdentity; task?: ProcessIdentity }
const config: Config = JSON.parse(process.argv[2] ?? "null");
let deadline = bootTimeMs() + ttl(config.ttl_seconds) * 1000;

const send = (payload: object) => process.stdout.write(JSON.stringify(payload) + "\n");
const finish = () => process.exit(0);
const reap = () => {
  if (bootTimeMs() >= deadline || !alive(config.parent) || (config.task && !alive(config.task))) finish();
};

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, finish);
process.stdout.on("error", finish);
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("close", finish);
input.on("line", line => {
  try {
    reap(); // An expired lease cannot be resurrected by renewal.
    const command: { id: number; ttl_seconds: number } = JSON.parse(line);
    if (!Number.isSafeInteger(command.id)) throw new Error("Invalid command ID");
    deadline = bootTimeMs() + ttl(command.ttl_seconds) * 1000;
    send({ id: command.id, deadline });
  } catch { process.exit(1); }
});
setInterval(() => {
  try { reap(); } catch { process.exit(1); }
}, 200);
reap();
send({ ready: true, deadline });
