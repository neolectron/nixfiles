import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { EventEmitter } from "node:events";
import { identity, type ProcessIdentity } from "./lifetime.js";

const run = promisify(execFile);
const configuredCommand = "@systemdInhibit@";
export const SYSTEMD_INHIBIT = configuredCommand.startsWith("@") ? "systemd-inhibit" : configuredCommand;
export interface Inhibitor { who: string; what: string; mode: string; pid: number; [key: string]: unknown }
export interface HeldLease {
  deadline: number;
  running: boolean;
  renew(seconds: number): Promise<number>;
  release(): Promise<void>;
  onExit(callback: () => void): void;
}
export interface Backend {
  acquire(taskId: string, reason: string, seconds: number, task?: ProcessIdentity): Promise<HeldLease>;
  list(): Promise<Inhibitor[]>;
}

class ChildLease extends EventEmitter implements HeldLease {
  deadline = 0;
  running = true;
  private sequence = 0;
  private pending = new Map<number, { resolve: (deadline: number) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  readonly ready: Promise<void>;
  private readonly exited: Promise<void>;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    super();
    let stderr = "";
    child.stderr.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-4096); });
    child.stdin.on("error", () => { /* close/ready handles EPIPE */ });
    const lines = createInterface({ input: child.stdout });
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.stdin.end();
        child.kill("SIGKILL"); // Only our newly spawned CLI, never a task PID.
        reject(new Error("systemd-inhibit did not become ready in five seconds"));
      }, 5000);
      lines.on("line", line => {
        try {
          const message = JSON.parse(line) as { ready?: boolean; id?: number; deadline: number };
          if (!Number.isFinite(message.deadline)) throw new Error("Invalid guard reply");
          if (message.ready) {
            this.deadline = message.deadline;
            clearTimeout(timer);
            resolve();
          } else if (message.id !== undefined) {
            const pending = this.pending.get(message.id);
            if (pending) {
              clearTimeout(pending.timer);
              this.pending.delete(message.id);
              this.deadline = message.deadline;
              pending.resolve(message.deadline);
            }
          }
        } catch {
          child.stdin.end();
          clearTimeout(timer);
          reject(new Error("Invalid inhibitor guard response"));
        }
      });
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("close", () => {
        clearTimeout(timer);
        reject(new Error(stderr.trim() || "Inhibitor guard exited before readiness"));
      });
    });
    this.exited = new Promise(resolve => {
      child.once("close", () => {
        this.running = false;
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error("Inhibitor is no longer active"));
        }
        this.pending.clear();
        this.emit("exit");
        resolve();
      });
    });
  }

  onExit(callback: () => void): void { this.once("exit", callback); }

  async renew(seconds: number): Promise<number> {
    if (!this.running) throw new Error("Inhibitor is no longer active");
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.child.stdin.end();
        reject(new Error("Inhibitor renewal timed out; released its control pipe"));
      }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, ttl_seconds: seconds }) + "\n");
    });
  }

  async release(): Promise<void> {
    this.child.stdin.end(); // EOF releases only this child; no arbitrary PID kill.
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([this.exited, new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          this.child.kill("SIGKILL");
          reject(new Error("Inhibitor cleanup not confirmed; terminated our CLI and finite guard TTL still applies"));
        }, 5000);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
}

export class SystemdBackend implements Backend {
  constructor(private readonly command = SYSTEMD_INHIBIT) {}

  async acquire(taskId: string, reason: string, seconds: number, task?: ProcessIdentity): Promise<HeldLease> {
    const guard = fileURLToPath(new URL("./guard.js", import.meta.url));
    const config = { ttl_seconds: seconds, parent: identity(process.pid), task };
    const child = spawn(this.command, [
      "--no-ask-password", "--what=sleep:idle", "--mode=block",
      `--who=keep-awake-mcp:${taskId}`, `--why=${reason}`, "--",
      process.execPath, guard, JSON.stringify(config),
    ], { stdio: ["pipe", "pipe", "pipe"], shell: false });
    const held = new ChildLease(child);
    try {
      await held.ready;
      if (!held.running) throw new Error("Inhibitor exited during acquisition");
      return held;
    } catch (error) {
      await held.release().catch(() => undefined);
      throw error;
    }
  }

  async list(): Promise<Inhibitor[]> {
    const { stdout } = await run(this.command, ["--list", "--json=short", "--no-pager"], {
      timeout: 5000, maxBuffer: 1024 * 1024, env: { ...process.env, LC_ALL: "C" },
    });
    const rows: unknown = JSON.parse(stdout);
    if (!Array.isArray(rows)) throw new Error("Unexpected systemd-inhibit listing");
    return rows as Inhibitor[];
  }
}
