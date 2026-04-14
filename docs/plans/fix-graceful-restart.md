# Fix: Graceful Restart Tool Not Working

## Problem

The `restart_on_idle` custom tool (`.opencode/tools/restart.ts`) schedules a background watcher
that polls the OpenCode server API until all sessions are idle, then restarts the systemd service.
It worked on the WSL setup but broke after the code was refactored/transferred to the NixOS host.

The watcher process spawns but dies silently without restarting the service, even when the user
stops interacting and the session should become idle.

## Observed Behavior

1. Tool is invoked → watcher spawns with a PID → returns immediately (correct).
2. User stops talking for 20+ seconds.
3. The watcher process dies (PID no longer exists) without restarting the service.
4. The lockfile `/tmp/opencode-restart-pending` is left behind (cleanup didn't run properly).
5. The OpenCode server process keeps the old PID indefinitely.

## Suspected Root Causes to Investigate

### 1. Session never transitions to "idle"

The server API at `GET /session/status?directory=...` returns `{"type":"busy"}` for the
current session even when the user hasn't sent a message in 20+ seconds. The watcher sees
this and keeps polling until timeout.

**Key question:** Does the OpenCode server consider a session "busy" as long as there's an
active SSE/WebSocket connection from a TUI or web client? If so, the session will NEVER be
idle while any client is connected, making the current approach fundamentally broken.

**Investigation steps:**

- Check the OpenCode source for how session status is determined.
- Look at what "idle" vs "busy" means in the `/session/status` API.
- Test: close all TUI/web clients, then curl the status endpoint — does it change to idle?
- Test: send a message, wait 30s, curl the status — still busy?

### 2. Watcher process dying prematurely

The watcher is spawned as a detached Bun subprocess running an inline script from `/tmp`.
Several things could kill it:

- **Bun process management:** `proc.unref()` is called but the parent process (the OpenCode
  plugin runtime) might still reap it or it might not fully detach.
- **The script itself errors out** — there's no error handling around the main loop. If
  `fetch()` throws for an unexpected reason or `Bun.spawn` for `systemctl` fails, the
  process exits silently.
- **Lockfile cleanup uses `require("fs")`** inside the spawned Bun script — this is a CJS
  pattern. The rest of the codebase uses ESM. Bun might handle this fine, but worth verifying.

**Investigation steps:**

- Add logging to the spawned script (write to `/tmp/opencode-restart.log`).
- Run the spawned script manually: `bun run /tmp/opencode-restart-<latest>.ts` and observe.
- Check if `require("fs")` works in Bun's context for the spawned script.

### 3. Service name mismatch (LIKELY)

The tool restarts `opencode.service` but the actual unit discovered on this system is
`opencode.service` — this matches. However, the original WSL setup might have used
`opencode-shared.service`. Verify the service name is correct.

**Current systemd unit:** `opencode.service` (confirmed via `systemctl --user list-units`).
**Tool uses:** `opencode.service` — this matches.

### 4. Bun availability in detached context

The spawned process uses `process.execPath` (the current Bun binary) to run the script.
On NixOS, this Nix store path should be stable. But if the tool runtime doesn't have Bun
in its environment, or if `process.execPath` resolves to something unexpected, the spawn
could fail silently.

**Investigation steps:**

- Log `process.execPath` in the tool before spawning.
- Verify the Bun binary exists at that path and is executable.

## Current Architecture

```
User calls restart_on_idle
       │
       ▼
.opencode/tools/restart.ts (runs in plugin runtime, uses bun:sqlite + Bun.spawn)
       │
       ├─ Reads DB: ~/.local/share/opencode/opencode-stable.db
       │  → Gets all directories with non-archived sessions
       │
       ├─ Writes inline script to /tmp/opencode-restart-<ts>.ts
       │
       ├─ Spawns: bun run /tmp/opencode-restart-<ts>.ts (detached, unref'd)
       │
       └─ Returns immediately with PID
              │
              ▼
       Watcher loop (detached process):
              │
              ├─ Polls: GET http://127.0.0.1:4096/session/status?directory=<dir>
              │  for each directory with active sessions
              │
              ├─ If all idle → systemctl --user restart opencode.service
              │
              └─ If timeout → notify-send warning
```

## Environment Details

- **OS:** NixOS (flake-based, rebuilt via `nixos-rebuild switch`)
- **OpenCode version:** 1.3.10 (`/nix/store/.../opencode-1.3.10/bin/opencode serve`)
- **Service:** `opencode.service` (systemd user unit, `Restart=always`, `RestartSec=2`)
- **Server URL:** `http://127.0.0.1:4096`
- **DB path:** `~/.local/share/opencode/opencode-stable.db`
- **Plugin runtime:** Bun (via `.opencode/tools/restart.ts`, OpenCode custom tool)
- **Active session directories:** `/home/neolectron/dev/nixfiles`, `/home/neolectron/.config/opencode`, `/home/neolectron`

## Files to Read

- `.opencode/tools/restart.ts` — the full tool implementation
- `~/.config/systemd/user/opencode.service` — the systemd unit
- `~/.config/opencode/opencode.jsonc` — global OpenCode config
- `.opencode/package.json` — plugin dependencies

## Recommended Fix Strategy

1. **First: add logging to the watcher script.** Write each poll result and any errors to
   `/tmp/opencode-restart.log`. This immediately reveals whether the issue is "session never
   becomes idle" or "watcher crashes".

2. **If session never becomes idle:** The `/session/status` API likely considers any connected
   client as "busy". The fix would be to check for _active tool calls or streaming_ specifically,
   not just connection status. Alternatively, add a grace period: if the session has been "busy"
   but no new messages for N seconds, treat it as idle.

3. **If watcher crashes:** Fix the error handling — wrap the main loop in try/catch, log errors,
   and ensure the lockfile is always cleaned up.

4. **Test the fix** by running the watcher manually with logging, then confirming it detects idle
   and triggers the restart.
