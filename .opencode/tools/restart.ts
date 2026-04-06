import { tool } from "@opencode-ai/plugin"
import { Database } from "bun:sqlite"
import path from "path"
import fs from "fs"

const DB_PATH = path.join(
  process.env.HOME || "~",
  ".local/share/opencode/opencode-stable.db",
)

const SERVER_URL = "http://127.0.0.1:4096"
const LOCKFILE = "/tmp/opencode-restart-pending"

/**
 * Graceful restart — waits for all sessions to be idle, then restarts.
 * Spawns a detached background process so it survives the restart.
 * Uses a lockfile to track pending state and prevent duplicate watchers.
 */
export const restart_on_idle = tool({
  description:
    "Schedule a graceful restart of the opencode-shared service. Spawns a background watcher that polls all active sessions and waits until every one is idle (no tool calls, no streaming), then restarts the service. Returns immediately — the restart happens in the background.",
  args: {
    timeout: tool.schema
      .number()
      .optional()
      .describe(
        "Max seconds to wait for idle before giving up (default: 120)",
      ),
    poll_interval: tool.schema
      .number()
      .optional()
      .describe("Seconds between status checks (default: 2)"),
  },
  async execute(args) {
    const timeout = args.timeout ?? 120
    const pollInterval = args.poll_interval ?? 2

    // Check if a restart is already pending
    if (fs.existsSync(LOCKFILE)) {
      try {
        const content = fs.readFileSync(LOCKFILE, "utf-8")
        const lock = JSON.parse(content)
        // Check if the watcher process is still alive
        try {
          process.kill(lock.pid, 0) // signal 0 = check existence
          return `A restart is already pending (PID: ${lock.pid}, scheduled at ${lock.time}). Wait for it or remove ${LOCKFILE} to reset.`
        } catch {
          // Process is dead — stale lockfile, clean up and proceed
          fs.unlinkSync(LOCKFILE)
        }
      } catch {
        // Corrupt lockfile, clean up and proceed
        fs.unlinkSync(LOCKFILE)
      }
    }

    // Get all distinct directories that have non-archived sessions
    const db = new Database(DB_PATH, { readonly: true })
    let directories: string[]
    try {
      const rows = db
        .prepare(
          `SELECT DISTINCT directory FROM session WHERE time_archived IS NULL`,
        )
        .all() as { directory: string }[]
      directories = rows.map((r) => r.directory)
    } finally {
      db.close()
    }

    if (directories.length === 0) {
      await Bun.$`systemctl --user restart opencode-web.service`.quiet()
      return "No active sessions found. Restarted immediately."
    }

    // Build the inline script that will run detached
    const script = `
const SERVER_URL = ${JSON.stringify(SERVER_URL)};
const directories = ${JSON.stringify(directories)};
const timeout = ${timeout};
const pollInterval = ${pollInterval};
const LOCKFILE = ${JSON.stringify(LOCKFILE)};

const startTime = Date.now();
const timeoutMs = timeout * 1000;
const pollMs = pollInterval * 1000;

function cleanup() {
  try { require("fs").unlinkSync(LOCKFILE); } catch {}
}

async function checkAllIdle() {
  for (const dir of directories) {
    try {
      const url = SERVER_URL + "/session/status?directory=" + encodeURIComponent(dir);
      const res = await fetch(url);
      if (!res.ok) continue;
      const statuses = await res.json();
      for (const [sid, status] of Object.entries(statuses) as [string, {type: string}][]) {
        if (status.type !== "idle") return false;
      }
    } catch {
      // Server might already be down, that's fine
      return true;
    }
  }
  return true;
}

async function main() {
  while (Date.now() - startTime < timeoutMs) {
    const idle = await checkAllIdle();
    if (idle) {
      await Bun.sleep(500);
      cleanup();
      const proc = Bun.spawn(["systemctl", "--user", "restart", "opencode-web.service"]);
      await proc.exited;
      process.exit(0);
    }
    await Bun.sleep(pollMs);
  }
  // Timed out
  cleanup();
  Bun.spawn(["notify-send", "-t", "10000", "OpenCode", "Restart timed out — sessions still busy after " + timeout + "s"]);
  process.exit(1);
}

main();
`

    // Write the script to a temp file and run it detached
    const scriptPath = path.join("/tmp", `opencode-restart-${Date.now()}.ts`)
    await Bun.write(scriptPath, script)

    const proc = Bun.spawn([process.execPath, "run", scriptPath], {
      stdio: ["ignore", "ignore", "ignore"],
    })
    proc.unref()

    // Write lockfile
    fs.writeFileSync(
      LOCKFILE,
      JSON.stringify({
        pid: proc.pid,
        time: new Date().toISOString(),
        timeout,
        directories: directories.length,
      }),
    )

    return `Graceful restart scheduled. Watching ${directories.length} directories, polling every ${pollInterval}s (timeout: ${timeout}s). The service will restart once all sessions are idle. PID: ${proc.pid}`
  },
})
