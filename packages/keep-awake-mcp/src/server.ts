#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { SystemdBackend } from "./backend.js";
import { Leases } from "./leases.js";
import { createServer } from "./mcp.js";

const leases = new Leases(new SystemdBackend());
const handle = serveStdio(() => createServer(leases));
let shuttingDown = false;
async function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { await leases.close(); await handle.close(); process.exit(0); }
  catch (error) { console.error(String(error)); process.exit(1); }
}
process.stdin.on("end", () => void stop());
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(signal, () => void stop());
process.on("uncaughtException", error => { console.error(String(error)); void stop(); });
process.on("unhandledRejection", error => { console.error(String(error)); void stop(); });
