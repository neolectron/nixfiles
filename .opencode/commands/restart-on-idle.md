---
description: Gracefully restart the opencode server once all sessions are idle
agent: system-assistant
---

Use the `restart_on_idle` tool to schedule a graceful restart of the opencode-shared service.

This spawns a background watcher that waits until all sessions are idle (no tool calls running, no assistant responses streaming), then restarts the service cleanly.

Just call the tool with default settings unless the user specified a custom timeout or poll interval.

After calling the tool, let the user know it's scheduled and they can keep working — the restart will happen automatically once this and all other sessions are idle.
