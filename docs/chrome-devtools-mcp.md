# Chrome DevTools MCP on NixOS

How chrome-devtools-mcp connects to Chrome on this NixOS system, what breaks, and how to fix it.

Last updated: 2026-04-07

## Working Configuration

```jsonc
// ~/.config/opencode/opencode.jsonc
{
  "mcp": {
    "chrome-devtools": {
      "type": "local",
      "command": ["nix", "shell", "nixpkgs#nodejs", "-c", "npx", "-y", "chrome-devtools-mcp@latest", "--autoConnect"]
    }
  }
}
```

### Why `nixpkgs#nodejs` and NOT `nixpkgs#bun`

OpenCode embeds its own bun runtime and injects a shim at `/tmp/bun-node-*/node`
that points to `.opencode-wrapped`. When the MCP spawns under `bunx`, the child
`node` process resolves to this shim. The shim's WebSocket implementation **cannot
complete Chrome CDP handshakes** -- it gets a valid 101 upgrade response but rejects
it with "Unexpected server response: 101".

Using `nixpkgs#nodejs` with `npx` bypasses the shim entirely. `nix shell` prepends
the real Node.js to PATH, so the MCP runs under genuine Node.js (v24+).

### Why `nix shell -c` and not `sh -c`

`nix shell <packages> -c <program> [args...]` passes args correctly when each arg
is a separate array element. No shell wrapper needed:

```
GOOD: ["nix", "shell", "nixpkgs#nodejs", "-c", "npx", "-y", "chrome-devtools-mcp@latest", "--autoConnect"]
BAD:  ["nix", "shell", "nixpkgs#nodejs", "-c", "npx -y chrome-devtools-mcp@latest --autoConnect"]
                                                 ^ single string = treated as program name, fails
```

## Architecture

```
Chrome (NixOS, everyday profile, no special CLI flags)
    |
chrome://inspect/#remote-debugging (must stay open as a tab)
    |
127.0.0.1:<port> (IPv4 only, dynamic port written to DevToolsActivePort)
    |
DevToolsActivePort file (~/.config/google-chrome/DevToolsActivePort)
    |
chrome-devtools-mcp --autoConnect (reads file once at startup)
    |
OpenCode (communicates with MCP over stdio)
```

### DevToolsActivePort file format

```
9222
/devtools/browser/330c6396-8a5e-4a65-a38f-1d21d32724a2
```

Line 1: TCP port. Line 2: WebSocket path for the browser-level CDP endpoint.
The MCP constructs `ws://127.0.0.1:<port><path>` (with `--userDataDir`) or
`ws://localhost:<port><path>` (channel-based auto-detection) from this.

## Known Issues

### 1. MCP dies when Chrome restarts (stale connection)

**Symptom:** Tools return "Could not find DevToolsActivePort" even though the file
exists and Chrome is running.

**Cause:** `--autoConnect` reads `DevToolsActivePort` once at MCP startup and opens
a persistent WebSocket. If Chrome restarts, the WebSocket dies. The MCP does not
re-read the file or reconnect. This is a known upstream limitation
([#1094](https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/1094),
closed as not planned).

**Fix:** Restart the MCP from OpenCode's web UI after restarting Chrome. You'll get
the "Allow remote debugging?" popup in Chrome -- click Allow.

**How to diagnose:**
```bash
# Compare timestamps: MCP should have started AFTER Chrome
ps -p $(pgrep -f chrome-devtools-mcp | tail -1) -o lstart=
ps -p $(pgrep -f 'google-chrome.*--ozone' | head -1) -o lstart=
```

### 2. localhost resolves to ::1 (IPv6) but Chrome listens on 127.0.0.1 (IPv4)

**Symptom:** Manual `websocat` to `ws://127.0.0.1:9222/...` works, but the MCP
(or `ws://localhost:9222/...`) fails.

**Cause:** On this system, `getent hosts localhost` returns `::1` (IPv6 only).
Chrome's `chrome://inspect` remote debugging server listens only on `127.0.0.1`
(IPv4). Some WebSocket clients try IPv6 first and don't fall back.

**Verify:**
```bash
getent hosts localhost          # shows ::1 = problem
ss -tlnp | grep <port>         # shows 127.0.0.1 only = Chrome is IPv4-only
```

**Relevance:** This was a contributing factor but NOT the root cause of the current
breakage. The real issue was the opencode bun shim (see above). If you add
`--userDataDir ~/.config/google-chrome` the MCP uses `ws://127.0.0.1` instead of
`ws://localhost`, but under the bun shim it still fails with "Unexpected server
response: 101".

### 3. Multiple MCP processes on the same debug port

**Symptom:** "Network.enable timed out" or tools work intermittently.

**Cause:** OpenCode sometimes spawns two MCP instances. Two CDP clients fighting
over one browser connection causes conflicts
([upstream #1763](https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/1763)).

**Fix:**
```bash
# Kill all and restart MCP from UI
pkill -f chrome-devtools-mcp
```

### 4. "Allow remote debugging?" popup timing

**Symptom:** MCP restart triggers a Chrome popup. If you don't click Allow quickly,
the MCP's connection attempt times out and it enters a permanent failed state.

**Fix:** After restarting the MCP, watch for the Chrome popup and click Allow
promptly. If you miss it, restart the MCP again.

### 5. `chrome://inspect` is NOT a full CDP HTTP server

**Symptom:** `curl http://127.0.0.1:9222/json/version` returns 404 or empty.

**Cause:** The `chrome://inspect` remote debugging feature creates a restricted
server that only accepts WebSocket upgrades. It does NOT support CDP HTTP discovery
endpoints (`/json`, `/json/version`, `/json/list`). This means `--browserUrl`
cannot be used -- only `--autoConnect` or `--wsEndpoint` work.

**Verify:**
```bash
curl -v http://127.0.0.1:9222/json/version    # 404 = chrome://inspect server
curl -v http://127.0.0.1:9222/                  # 404 = same

# WebSocket works:
echo '{"id":1,"method":"Browser.getVersion"}' | \
  websocat -n1 ws://127.0.0.1:9222/devtools/browser/<id-from-DevToolsActivePort>
```

## Debugging Checklist (Quick)

```bash
# 1. Is Chrome running?
pgrep -a google-chrome | head -1

# 2. Is chrome://inspect tab open and remote debugging enabled?
#    Check Chrome UI: should show "Server running at: 127.0.0.1:<port>"

# 3. Is DevToolsActivePort fresh?
cat ~/.config/google-chrome/DevToolsActivePort
stat ~/.config/google-chrome/DevToolsActivePort

# 4. Is the port actually listening?
ss -tlnp | grep $(head -1 ~/.config/google-chrome/DevToolsActivePort)

# 5. Can we reach Chrome over WebSocket?
PORT=$(head -1 ~/.config/google-chrome/DevToolsActivePort)
WSPATH=$(tail -1 ~/.config/google-chrome/DevToolsActivePort)
echo '{"id":1,"method":"Browser.getVersion"}' | \
  nix shell nixpkgs#websocat -c websocat -n1 "ws://127.0.0.1:${PORT}${WSPATH}"

# 6. Is the MCP process alive and recent?
ps aux | grep '[c]hrome-devtools-mcp'

# 7. Did MCP start AFTER Chrome? (stale connection check)
ps -p $(pgrep -f chrome-devtools-mcp | tail -1) -o lstart= 2>/dev/null
ps -p $(pgrep -f 'google-chrome.*--ozone' | head -1) -o lstart= 2>/dev/null

# 8. Is there only ONE MCP instance? (multiple = conflicts)
pgrep -c -f chrome-devtools-mcp  # should be 2-3 (npm + node + watchdog), not 4-6

# 9. Nuclear restart
pkill -f chrome-devtools-mcp
# Then restart MCP from OpenCode UI and click Allow in Chrome
```

## Deep Diagnostics

### Chrome process and flags

```bash
# Full Chrome process command (check it was started without debug flags)
ps aux | grep -E '[g]oogle-chrome|[c]hromium' | head -5

# Chrome version
google-chrome-stable --version
```

### Network layer

```bash
# What process owns the debug port?
ss -tlnp | grep 9222

# Is localhost IPv4 or IPv6? (::1 = problem, see Known Issue #2)
getent hosts localhost

# Test HTTP endpoints (all should return 404 with chrome://inspect)
curl -v http://127.0.0.1:9222/json/version
curl -v http://127.0.0.1:9222/json/list
curl -v http://127.0.0.1:9222/

# Test WebSocket handshake with verbose headers
curl -v \
  -H "Upgrade: websocket" \
  -H "Connection: Upgrade" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Version: 13" \
  http://127.0.0.1:9222/devtools/browser/<id>
# Should return HTTP 101 WebSocket Protocol Handshake

# Test WebSocket with IPv4 vs IPv6 (verbose, shows fallback behavior)
PORT=$(head -1 ~/.config/google-chrome/DevToolsActivePort)
WSPATH=$(tail -1 ~/.config/google-chrome/DevToolsActivePort)
nix shell nixpkgs#websocat -c websocat -v "ws://127.0.0.1:${PORT}${WSPATH}"
nix shell nixpkgs#websocat -c websocat -v "ws://localhost:${PORT}${WSPATH}"
# localhost will show: "Failure during connecting TCP: Connection refused (os error 111)"
# then fall back to IPv4. Node.js ws library may NOT fall back.

# Send a CDP command and get a response (proves protocol works end-to-end)
echo '{"id":1,"method":"Browser.getVersion"}' | \
  nix shell nixpkgs#websocat -c websocat -n1 "ws://127.0.0.1:${PORT}${WSPATH}"
```

### MCP process inspection

```bash
# Full command line of the MCP node process
cat /proc/$(pgrep -f 'node.*chrome-devtools-mcp' | head -1)/cmdline | tr '\0' '\n'

# Environment variables (check PATH, HOME, NODE, XDG_CONFIG_HOME)
cat /proc/$(pgrep -f 'node.*chrome-devtools-mcp' | head -1)/environ | tr '\0' '\n' | \
  grep -E '^PATH=|^HOME=|^NODE=|^XDG_CONFIG_HOME=|^CHROME_CONFIG_HOME='

# Check which `node` binary the MCP is actually using
# If it shows /tmp/bun-node-*/node -> .opencode-wrapped, that's the broken shim
ls -la /tmp/bun-node-*/node 2>/dev/null

# Check if MCP has any TCP connections to Chrome (should see ESTAB to port 9222)
ss -tnp | grep $(pgrep -f 'node.*chrome-devtools-mcp' | head -1)

# Check what sockets the MCP node process has open
ls -la /proc/$(pgrep -f 'node.*chrome-devtools-mcp' | head -1)/fd/ 2>/dev/null | head -20
```

### DevToolsActivePort file

```bash
# Is it a real file or a symlink? (WSL uses symlink, native Linux uses real file)
ls -la ~/.config/google-chrome/DevToolsActivePort
readlink -f ~/.config/google-chrome/DevToolsActivePort

# File permissions (MCP process must be able to read it)
stat ~/.config/google-chrome/DevToolsActivePort

# Compare file modification time with Chrome start time
# File mtime should be within seconds of Chrome start
stat -c "%y" ~/.config/google-chrome/DevToolsActivePort
ps -p $(pgrep -f 'google-chrome.*--ozone' | head -1) -o lstart=
```

### OpenCode logs

```bash
# Find the latest opencode log
ls -t ~/.local/share/opencode/log/*.log | head -1

# Search for MCP connection events
rg -i "chrome-devtools|DevToolsActive" ~/.local/share/opencode/log/*.log | tail -20

# Look for "successfully created client" (MCP stdio connected, not Chrome connected)
rg "chrome-devtools.*create\(\)" ~/.local/share/opencode/log/*.log | tail -5
```

### Manual MCP test (bypass OpenCode entirely)

```bash
# Run chrome-devtools-mcp standalone with debug logging
# If this works but the OpenCode-spawned one doesn't, the issue is the runtime
timeout 10 nix shell nixpkgs#nodejs -c sh -c \
  'DEBUG="*" npx -y chrome-devtools-mcp@latest --autoConnect --logFile /tmp/mcp-debug.log 2>&1'
cat /tmp/mcp-debug.log
# Should show: "Chrome DevTools MCP Server connected"

# Run with real bun to compare (will use opencode's shim if spawned by opencode)
timeout 10 nix shell nixpkgs#bun -c sh -c \
  'DEBUG="*" bunx chrome-devtools-mcp@latest --autoConnect --logFile /tmp/mcp-debug-bun.log 2>&1'
cat /tmp/mcp-debug-bun.log
```

### MCP source code inspection

```bash
# The MCP source lives in a temp directory managed by npx/bunx
ls /tmp/bunx-1000-chrome-devtools-mcp@latest/node_modules/chrome-devtools-mcp/build/src/
# or
ls ~/.npm/_npx/*/node_modules/chrome-devtools-mcp/build/src/

# Key files:
# browser.js    - connection logic, DevToolsActivePort reading
# third_party/index.js - bundled Puppeteer, WebSocket transport, resolveDefaultUserDataDir

# Search for the DevToolsActivePort reading code
rg "DevToolsActivePort" /tmp/bunx-1000-chrome-devtools-mcp@latest/node_modules/chrome-devtools-mcp/build/src/browser.js

# Search for the URL construction (ws://localhost vs ws://127.0.0.1)
rg "ws://" /tmp/bunx-1000-chrome-devtools-mcp@latest/node_modules/chrome-devtools-mcp/build/src/third_party/index.js

# Check which user data dir path Puppeteer resolves for Linux
rg -A 5 "LINUX" /tmp/bunx-1000-chrome-devtools-mcp@latest/node_modules/chrome-devtools-mcp/build/src/third_party/index.js | head -20
```

## WSL-Specific Notes (from previous setup)

On WSL2 with mirrored networking, the setup also worked with `--autoConnect` but
required a symlink from `~/.config/google-chrome/DevToolsActivePort` to the
Windows-side file:

```bash
ln -sf \
  "/mnt/c/Users/<you>/AppData/Local/Google/Chrome/User Data/DevToolsActivePort" \
  ~/.config/google-chrome/DevToolsActivePort
```

Full WSL2 guide: `/home/neolectron/dev/formula.now/.opencode/docs/wsl2-chrome-mcp-setup.md`

## Upstream References

- [chrome-devtools-mcp repo](https://github.com/ChromeDevTools/chrome-devtools-mcp)
- [#1094](https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/1094) - Stale connection after browser restart (closed, not planned)
- [#1194](https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/1194) - --browserUrl doesn't work with chrome://inspect (closed)
- [#1794](https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/1794) - Repeated "Allow" popups (open)
- [#1763](https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/1763) - Multiple MCP processes conflict (closed, duplicate)
- [#825](https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/825) - Persist debugging approval (open)
