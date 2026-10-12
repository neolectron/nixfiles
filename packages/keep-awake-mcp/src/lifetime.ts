import { readFileSync, statSync } from "node:fs";

export const MAX_TTL = 14_400;
export const DEFAULT_TTL = 900;
export const MAX_LEASES = 64;

export function bootTimeMs(): number {
  // /proc/uptime includes suspend time and is immune to wall-clock changes.
  const value = Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]);
  if (!Number.isFinite(value)) throw new Error("Cannot read boot time");
  return value * 1000;
}

export interface ProcessIdentity { pid: number; start: string; uid: number }

export function identity(pid: number): ProcessIdentity {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("task_pid must be a positive local PID");
  const path = `/proc/${pid}`;
  const fields = readFileSync(`${path}/stat`, "utf8");
  const tail = fields.slice(fields.lastIndexOf(")") + 2).trim().split(/\s+/);
  if (!tail[19] || tail[0] === "Z" || tail[0] === "X") throw new Error("Process already exited");
  return { pid, start: tail[19], uid: statSync(path).uid };
}

export function alive(expected: ProcessIdentity): boolean {
  try {
    const actual = identity(expected.pid);
    return actual.start === expected.start && actual.uid === expected.uid;
  } catch { return false; }
}

export function ttl(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TTL) {
    throw new Error(`ttl_seconds must be an integer from 1 to ${MAX_TTL}`);
  }
  return value;
}

export function text(value: string, name: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\x00-\x1f\x7f]/u.test(value)) {
    throw new Error(`${name} must be nonempty text, at most ${maximum} characters, without controls`);
  }
  return value;
}
