import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import { createServer } from "../src/mcp.js";
import { Leases } from "../src/leases.js";
import type { Backend } from "../src/backend.js";

test("official SDK client negotiates tools and validates input without logind", async () => {
  const backend: Backend = { acquire: async () => { throw new Error("mock acquisition denied"); }, list: async () => [] };
  const leases = new Leases(backend);
  const server = createServer(leases);
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    assert.equal((await client.listTools()).tools.length, 4);
    const status = await client.callTool({ name: "keep_awake_status", arguments: {} });
    assert.equal(status.isError, false);
    const denied = await client.callTool({ name: "keep_awake_acquire", arguments: { task_id: "test", reason: "test" } });
    assert.equal(denied.isError, true);
    const invalid = await client.callTool({ name: "keep_awake_acquire", arguments: { task_id: "test", reason: "test", ttl_seconds: 0 } });
    assert.equal(invalid.isError, true);
    const arbitrary = await client.callTool({ name: "keep_awake_status", arguments: { shell: "anything" } });
    assert.equal(arbitrary.isError, true);
    await assert.rejects(client.callTool({ name: "suspend", arguments: {} }));
  } finally { await client.close(); await server.close(); await leases.close(); }
});
