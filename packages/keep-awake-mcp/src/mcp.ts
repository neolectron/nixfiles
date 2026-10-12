import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { Leases } from "./leases.js";
import { DEFAULT_TTL, MAX_TTL } from "./lifetime.js";

export function createServer(leases: Leases): McpServer {
  const server = new McpServer({ name: "keep-awake", version: "0.1.0" });
  const shortText = z.string().min(1).max(128);
  const duration = z.number().int().min(1).max(MAX_TTL).default(DEFAULT_TTL);
  const result = async (action: () => Promise<unknown>) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await action()) }], isError: false }; }
    catch (error) { return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }], isError: true }; }
  };
  server.registerTool("keep_awake_status", {
    description: "Read this MCP session's leases and all system logind inhibitors. Does not change power state.",
    inputSchema: z.strictObject({}), annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => result(() => leases.status()));
  server.registerTool("keep_awake_acquire", {
    description: "Temporarily prevent sleep for a local task. Retain returned lease_id. Optional task_pid releases on that exact same-user process's exit. No automatic task lifecycle hook.",
    inputSchema: z.strictObject({ task_id: shortText, reason: z.string().min(1).max(512), ttl_seconds: duration, task_pid: z.number().int().positive().optional() }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, args => result(() => leases.acquire(args)));
  server.registerTool("keep_awake_renew", {
    description: "Explicitly extend an active lease owned by this MCP session for a bounded duration.",
    inputSchema: z.strictObject({ lease_id: shortText, ttl_seconds: duration }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, args => result(() => leases.renew(args.lease_id, args.ttl_seconds)));
  server.registerTool("keep_awake_release", {
    description: "Release only the named lease owned by this MCP session. Never forces sleep or clears another app's inhibitors.",
    inputSchema: z.strictObject({ lease_id: shortText }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, args => result(() => leases.release(args.lease_id)));
  return server;
}
