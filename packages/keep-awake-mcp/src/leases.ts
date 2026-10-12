import { randomUUID } from "node:crypto";
import type { Backend, HeldLease } from "./backend.js";
import { bootTimeMs, DEFAULT_TTL, MAX_LEASES, MAX_TTL, identity, text, ttl } from "./lifetime.js";

interface Lease { task_id: string; reason: string; task_pid?: number; held: HeldLease }
export interface Acquire { task_id: string; reason: string; ttl_seconds?: number; task_pid?: number }

export class Leases {
  private readonly leases = new Map<string, Lease>();
  private readonly pendingTasks = new Set<string>();
  private closed = false;
  constructor(private readonly backend: Backend, private readonly now = bootTimeMs) {}

  private public(id: string, lease: Lease) {
    return { lease_id: id, task_id: lease.task_id, reason: lease.reason, task_pid: lease.task_pid,
      remaining_seconds: Math.max(0, Math.ceil((lease.held.deadline - this.now()) / 1000)) };
  }

  async acquire(args: Acquire) {
    const taskId = text(args.task_id, "task_id", 128);
    const reason = text(args.reason, "reason", 512);
    const seconds = ttl(args.ttl_seconds ?? DEFAULT_TTL);
    if (this.closed) throw new Error("Server is shutting down");
    if (this.leases.size + this.pendingTasks.size >= MAX_LEASES) throw new Error("Maximum leases reached");
    if (this.pendingTasks.has(taskId) || [...this.leases.values()].some(lease => lease.task_id === taskId)) {
      throw new Error("task_id already active in this session; renew its lease");
    }
    const task = args.task_pid === undefined ? undefined : identity(args.task_pid);
    if (task && task.uid !== process.getuid!()) throw new Error("task_pid must belong to the current user");
    this.pendingTasks.add(taskId);
    try {
      const held = await this.backend.acquire(taskId, reason, seconds, task);
      if (this.closed || !held.running || held.deadline <= this.now()) {
        await held.release();
        throw new Error("Server closed or lease expired during acquisition");
      }
      const id = randomUUID();
      const lease: Lease = { task_id: taskId, reason, task_pid: args.task_pid, held };
      this.leases.set(id, lease);
      held.onExit(() => this.leases.delete(id));
      return this.public(id, lease);
    } finally { this.pendingTasks.delete(taskId); }
  }

  async release(id: string) {
    text(id, "lease_id", 128);
    const lease = this.leases.get(id);
    if (!lease) return { released: false, reason: "unknown, expired, or another MCP session's lease" };
    await lease.held.release();
    this.leases.delete(id);
    return { released: true };
  }

  async renew(id: string, seconds = DEFAULT_TTL) {
    text(id, "lease_id", 128);
    ttl(seconds);
    const lease = this.leases.get(id);
    if (!lease || !lease.held.running || lease.held.deadline <= this.now()) throw new Error("Lease not active in this MCP session");
    await lease.held.renew(seconds);
    return this.public(id, lease);
  }

  async status() {
    const session_leases = [...this.leases].filter(([, lease]) => lease.held.running && lease.held.deadline > this.now()).map(([id, lease]) => this.public(id, lease));
    let system_inhibitors: Awaited<ReturnType<Backend["list"]>> = [];
    let system_status_error: string | null = null;
    try { system_inhibitors = await this.backend.list(); }
    catch (error) { system_status_error = error instanceof Error ? error.message : String(error); }
    return { session_leases, session_inhibited: session_leases.length > 0, system_inhibitors, system_status_error,
      max_ttl_seconds: MAX_TTL, scope: "logind sleep:idle block; desktop screen-off and locking remain enabled" };
  }

  async close(): Promise<void> {
    this.closed = true;
    const results = await Promise.allSettled([...this.leases.values()].map(lease => lease.held.release()));
    this.leases.clear();
    const failed = results.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }
}
