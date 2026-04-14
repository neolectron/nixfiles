import { tool } from '@opencode-ai/plugin';
import path from 'path';
import fs from 'fs';

const SERVER_URL = 'http://127.0.0.1:4096';
const SERVICE = 'opencode.service';
const LOCKFILE = '/tmp/opencode-restart-pending';
const LOGFILE = '/tmp/opencode-restart.log';
const WATCHER = path.join(
  import.meta.dirname,
  '..',
  'lib',
  'restart-watcher.sh',
);

export const restart_on_idle = tool({
  description:
    'Schedule a graceful restart of the opencode-shared service. Spawns a background watcher that polls all active sessions and waits until every one is idle (no tool calls, no streaming), then restarts the service. Returns immediately — the restart happens in the background.',
  args: {
    timeout: tool.schema
      .number()
      .optional()
      .default(120)
      .describe('Max seconds to wait for idle before giving up (default: 120)'),
    poll_interval: tool.schema
      .number()
      .optional()
      .default(3)
      .describe('Seconds between status checks (default: 3)'),
  },
  async execute(args) {
    const timeout = args.timeout;
    const poll = args.poll_interval;

    // Prevent duplicate watchers
    if (fs.existsSync(LOCKFILE)) {
      try {
        const lock = JSON.parse(fs.readFileSync(LOCKFILE, 'utf-8'));
        try {
          process.kill(lock.pid, 0);
          return `A restart is already pending (PID: ${lock.pid}, scheduled at ${lock.time}). Wait for it or remove ${LOCKFILE} to reset.`;
        } catch {
          fs.unlinkSync(LOCKFILE);
        }
      } catch {
        try {
          fs.unlinkSync(LOCKFILE);
        } catch {}
      }
    }

    // Spawn the bash watcher detached
    const proc = Bun.spawn(
      [
        'bash',
        WATCHER,
        SERVER_URL,
        String(timeout),
        String(poll),
        LOCKFILE,
        LOGFILE,
        SERVICE,
      ],
      { stdio: ['ignore', 'ignore', 'ignore'] },
    );
    proc.unref();

    fs.writeFileSync(
      LOCKFILE,
      JSON.stringify({
        pid: proc.pid,
        time: new Date().toISOString(),
        timeout,
      }),
    );

    return `Graceful restart scheduled (PID: ${proc.pid}). Polling every ${poll}s, timeout ${timeout}s. Check ${LOGFILE} for watcher output.`;
  },
});
