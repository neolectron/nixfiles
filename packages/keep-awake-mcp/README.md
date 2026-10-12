# Temporary sleep inhibition over MCP

A local TypeScript server using the **official MCP SDK v2** (`@modelcontextprotocol/server` 2.3.1), Node.js 24 and the existing `systemd-inhibit` CLI. It participates in the root pnpm workspace and also builds independently through Nix.

| Tool | Behavior |
| --- | --- |
| `keep_awake_status` | Read this connection's leases and all logind inhibitors. |
| `keep_awake_acquire` | Acquire a `sleep:idle`, `block` inhibitor with task ID, reason, TTL and optional local task PID. |
| `keep_awake_renew` | Explicitly extend an active lease by a bounded duration. |
| `keep_awake_release` | Release only this connection's named lease. Unknown/expired/foreign IDs are harmless no-ops. |

The CLI adapter invokes fixed argument arrays, with `shell: false` and `--no-ask-password`. It never offers arbitrary commands, suspend, hibernate, shutdown or reboot. It changes no idle setting, Noctalia toggle, listener, credentials, sudo or Polkit rules. Starting the server alone creates no inhibition.

## Lifetime and ownership

Each task has an independent `systemd-inhibit` process and unpredictable `lease_id`. A small TypeScript guard runs **under** that CLI's lock. The guard sends readiness only once `systemd-inhibit` has acquired the inhibition and launched it. The client gets a tool error if the existing OS policy denies acquisition; there is no auth or permission-creation fallback.

Integer `ttl_seconds` is 1–14,400 (four hours), default 900 (15 minutes). Acquire/renew are bounded and there is no automatic renewal. A guard checks every 200 ms using `/proc/uptime` (boot time including suspend, immune to clock corrections). It exits on expiry, control-pipe EOF, parent exit, optional task exit, or malformed control input. The CLI then closes that lease's FD. The independent timer continues when the MCP parent is frozen; parent crash/termination closes its control pipes. A renewal must receive the guard's acknowledgement before reporting success.

At most 64 active/pending leases exist per connection. Concurrent duplicate task IDs cannot create two locks. Different client connections can use the same task ID, but cannot release or renew one another's leases. No persistent state files, PID files or background daemon exist. Release closes only that lease's private control pipe and waits for exit, without signalling any external task/app PID. Readiness/cleanup timeout force-terminates only the CLI process created for that lease, never a PID supplied by a tool caller. EOF, SIGTERM, SIGINT and SIGHUP clean up all leases owned by the connection. Failed cleanup is reported instead of claimed successful; the independent finite TTL remains the fallback. Backend/guard readiness calls time out after five seconds.

An external program freezing **both** the server and its guard can prevent their timers from running until resumed; ordinary Linux inhibitors are cooperative, and privileged software can deliberately bypass them. The service does not change those OS semantics.

Other system inhibitors appear read-only in status. Reasons/task IDs should be short descriptions, never secrets. Session inhibition is distinct from other apps' inhibitors. Screen-off and screen locking remain enabled. Release resumes the normal idle policy; it does not ask the computer to sleep.

## Task lifecycle

**No Codex/OpenCode task lifecycle hook is installed.** MCP registration alone does not automatically keep every task awake. A client/task runner must actually:

1. Acquire at task start, for example `{"task_id":"local-build-42","reason":"Building the local project","ttl_seconds":900}`.
2. Retain `lease_id` on the same live MCP connection, and explicitly renew before expiry when more work is needed.
3. Release that exact ID in completion/cancellation/failure/finally paths. Disconnect closes the connection's other leases too, so share connections deliberately.

For process-backed local work, include `task_pid` from the **actual spawned task**. The server validates same-user ownership; the guard matches PID **and `/proc/PID/stat` start time and UID**, rejecting PID reuse and zombies. It releases on that process's exit without signalling it. A long-lived agent PID is not a per-task hook, remote task PIDs are meaningless locally, and subprocesses outliving the watched parent need their own lifetime binding. Bounded TTL and explicit release still apply.

## Development and Nix

The package exports `build`, `typecheck`, `test` and opt-in `smoke` scripts. Dependencies retain exact pins. Use pnpm from the monorepo root; `pnpm-lock.yaml` covers both workspace tools. The local `package-lock.json` is deliberately retained unchanged: `buildNpmPackage` consumes it for the isolated Nix build and verifies `npmDepsHash`. It is not a competing workspace install. Dependency changes must update both locks and the Nix hash together; script-only changes do not affect that hash. Root workspace files remain coordinator-owned.

```sh
# From nixfiles root, workspace development:
nix-shell packages/streamdeck/shell.nix
pnpm install --frozen-lockfile
pnpm --filter keep-awake-mcp typecheck
pnpm keep-awake:test
pnpm keep-awake:build

# Optional standalone npm development, separate from the workspace install:
# Use a separate clean package copy; npm ci replaces its node_modules.
npm ci --ignore-scripts
npm test

# From nixfiles root:
nix flake check --no-write-lock-file
nix build .#keep-awake-mcp --out-link /tmp/keep-awake-mcp-result
nix run .#keep-awake-mcp
```

For installation limited to this package, without Home Manager or a global
NixOS switch, build a retained output link from the coordinated worktree:

```sh
nix build .#keep-awake-mcp --no-write-lock-file --out-link packages/keep-awake-mcp/result
readlink -f packages/keep-awake-mcp/result
```

Use the resulting `/nix/store/...-keep-awake-mcp-0.1.0/bin/keep-awake-mcp` directly.
The output link is a GC root; retain it while a client uses that executable.
There is no need to activate the entire frostbit configuration to use this
package. The client-installation worker owns any approved MCP registration;
this integration does not change live client configuration.

The server speaks MCP over stdio using the SDK's `serveStdio`, including its supported legacy clients. Nix builds TypeScript, runs mock tests, and installs Node plus locked runtime dependencies without npm downloads at runtime. The reusable `homeManager.keepAwake` module installs the executable; frostbit imports it. Installation follows `AGENTS.md` and `.codex/skills/nixfiles-maintenance/SKILL.md`, with Home Manager generation comparison and coordinated system activation; do not use standalone `home-manager switch`.

## MCP client registration

Executable installation and persistent MCP access are separate. `codex.toml.example` is inert, disabled and not loaded automatically. Obtain action-specific approval before adding/enabling its exact command and four tools in the live client. No network/credential setup is required. Use the absolute installed/built executable path; verify initialize, tools/list and status in the actual client after enabling it. Standalone smoke does not prove registration in the user's client.

See [official Codex MCP configuration](https://developers.openai.com/codex/mcp/). The MCP server must execute locally on frostbit; a cloud-only client cannot control frostbit by loading a local config. Remote exposure would be a separate security/network change.

## Verification

`npm test` covers mocked CLI argument safety/readiness/EOF, 40 concurrent tasks, caps/duplicates, validation, denied acquisition, explicit renewal/expiry, isolation, PID identity, guard expiry while its parent is frozen/crashed, task exit, and negotiation/validation with the official SDK client. These tests acquire no actual inhibitors.

The opt-in real smoke uses the official SDK client, checks all four tools and only acquires briefly lived test locks. It signals only its own freshly spawned test servers/tasks, never an existing app or task. It checks independent release, foreign-session refusal, idle-input expiry, EOF, SIGKILL/SIGTERM, exact task exit, deadline expiry with a frozen MCP parent and preservation of all existing inhibitors. No actual suspend/reboot is used as a test.

```sh
# After npm ci/build, from the package:
npm run smoke
# Test the built Nix executable using the local development SDK client:
node dist/test/smoke.js /tmp/keep-awake-mcp-result/bin/keep-awake-mcp
```

Subprocess pipes/PID inspection and the real system bus require ordinary local execution; a restricted tool sandbox can deny them. Tests needing local access do not require new Polkit rules.

## Existing frostbit behavior

`Mod+Shift+C` calls Noctalia's global manual `idleInhibitor toggle`, including native Wayland idle inhibition. We leave it independent: disabling it could clear the user's manual inhibition. Current idle settings are screen-off 300 s, lock 360 s, suspend 1,800 s. The pinned Noctalia source calls `systemctl suspend || loginctl suspend`; our CLI instead holds logind's `sleep` block without requesting either command. systemd 261 distinguishes `block` from `block-weak`; this package uses `block`.

References: [official SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/), [stdio serving](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.html), [systemd 261 logind](https://github.com/systemd/systemd/blob/v261/src/login/logind-dbus.c).
