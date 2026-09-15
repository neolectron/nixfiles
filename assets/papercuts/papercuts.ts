#!/usr/bin/env -S node --experimental-strip-types

const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DEFAULT_TTL_MS = 3 * DAY_MS;
const MAX_TTL_MS = 7 * DAY_MS;
const LOCK_TIMEOUT_MS = 5 * 1000;
const LOCK_STALE_MS = 30 * 1000;
const LOCK_RETRY_MS = 25;

type Papercut = {
  id: string;
  repo: string;
  where: string;
  why: string;
  fix: string;
  expires: string;
  seen?: number;
};

type RecordInput = {
  where: string;
  why: string;
  fix: string;
  ttlMs: number;
};

type PapercutsApi = {
  record: (input: RecordInput) => { status: "added" | "deduplicated"; record: Papercut };
  list: () => Papercut[];
  close: (idPrefix: string) => Papercut;
};

type ObjectRecord = Record<string, unknown>;

const isObjectRecord = (value: unknown): value is ObjectRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const errorCode = (value: unknown): string | undefined => {
  if (!isObjectRecord(value) || typeof value.code !== "string") return undefined;
  return value.code;
};

const parseNow = (): Date => {
  const now = process.env.PAPERCUTS_NOW
    ? new Date(process.env.PAPERCUTS_NOW)
    : new Date();
  if (Number.isNaN(now.getTime())) throw new Error("PAPERCUTS_NOW must be an ISO timestamp");
  return now;
};

const normalize = (value: string): string => value.trim().replace(/\s+/g, " ").toLowerCase();

const requiredText = (value: string | null, name: string): string => {
  const text = value?.trim() ?? "";
  if (text.length === 0) throw new Error(`${name} must not be empty`);
  return text;
};

const parseTtl = (value: string | null): number => {
  if (value === null) return DEFAULT_TTL_MS;
  const match = /^(\d+)(h|d)$/.exec(value.trim());
  if (!match) throw new Error("--ttl must look like 24h or 3d");
  const amount = Number(match[1]);
  const ttlMs = amount * (match[2] === "d" ? DAY_MS : HOUR_MS);
  if (ttlMs < HOUR_MS || ttlMs > MAX_TTL_MS) {
    throw new Error("--ttl must be between 1h and 7d");
  }
  return ttlMs;
};

const decodeRecord = (value: unknown): Papercut | null => {
  if (!isObjectRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.repo !== "string" ||
    typeof value.where !== "string" ||
    typeof value.why !== "string" ||
    typeof value.fix !== "string" ||
    typeof value.expires !== "string"
  ) return null;
  if (value.seen !== undefined && (typeof value.seen !== "number" || value.seen < 2)) return null;
  if (Number.isNaN(new Date(value.expires).getTime())) return null;
  return {
    id: value.id,
    repo: value.repo,
    where: value.where,
    why: value.why,
    fix: value.fix,
    expires: value.expires,
    ...(value.seen === undefined ? {} : { seen: value.seen }),
  };
};

const createApi = ({ file, now, repo }: { file: string; now: Date; repo: string }): PapercutsApi => {
  const lockFile = `${file}.lock`;

  const ensureParent = (): void => {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  };

  const readRecords = (): Papercut[] => {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch (error) {
      if (errorCode(error) === "ENOENT") return [];
      throw error;
    }
    return content.split("\n").filter(Boolean).map((line, index) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new Error(`invalid papercuts JSON at line ${index + 1}`);
      }
      const record = decodeRecord(parsed);
      if (record === null) throw new Error(`invalid papercut record at line ${index + 1}`);
      return record;
    });
  };

  const writeRecords = (records: Papercut[]): void => {
    if (records.length === 0) {
      fs.rmSync(file, { force: true });
      return;
    }
    ensureParent();
    const temporaryFile = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(temporaryFile, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(temporaryFile, file);
    fs.chmodSync(file, 0o600);
  };

  const wait = (): void => {
    const buffer = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(buffer), 0, 0, LOCK_RETRY_MS);
  };

  const withLock = <Result>(operation: () => Result): Result => {
    ensureParent();
    const startedAt = Date.now();
    while (true) {
      try {
        const descriptor = fs.openSync(lockFile, "wx", 0o600);
        fs.closeSync(descriptor);
        break;
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
        let stale = false;
        try {
          stale = Date.now() - fs.statSync(lockFile).mtimeMs > LOCK_STALE_MS;
        } catch (statError) {
          if (errorCode(statError) !== "ENOENT") throw statError;
        }
        if (stale) {
          fs.rmSync(lockFile, { force: true });
          continue;
        }
        if (Date.now() - startedAt > LOCK_TIMEOUT_MS) {
          throw new Error("papercuts state is locked; retry shortly");
        }
        wait();
      }
    }
    try {
      return operation();
    } finally {
      fs.rmSync(lockFile, { force: true });
    }
  };

  const removeExpired = (records: Papercut[]): Papercut[] => {
    const live = records.filter((record) => new Date(record.expires).getTime() > now.getTime());
    if (live.length !== records.length) writeRecords(live);
    return live;
  };

  const fingerprint = (record: Pick<Papercut, "repo" | "where" | "why">): string =>
    `${record.repo}\u0000${normalize(record.where)}\u0000${normalize(record.why)}`;

  const makeId = (record: Pick<Papercut, "repo" | "where" | "why">): string =>
    `p_${createHash("sha256").update(fingerprint(record)).digest("hex").slice(0, 10)}`;

  const record = (input: RecordInput): { status: "added" | "deduplicated"; record: Papercut } =>
    withLock(() => {
      const records = removeExpired(readRecords());
      const where = requiredText(input.where, "--where");
      const why = requiredText(input.why, "why");
      const fix = requiredText(input.fix, "--fix");
      const candidate: Papercut = {
        id: makeId({ repo, where, why }),
        repo,
        where,
        why,
        fix,
        expires: new Date(now.getTime() + input.ttlMs).toISOString(),
      };
      const existingIndex = records.findIndex((item) => fingerprint(item) === fingerprint(candidate));
      if (existingIndex >= 0) {
        const existing = records[existingIndex];
        const updated: Papercut = {
          ...existing,
          fix: candidate.fix,
          expires: new Date(
            Math.max(new Date(existing.expires).getTime(), new Date(candidate.expires).getTime()),
          ).toISOString(),
          seen: (existing.seen ?? 1) + 1,
        };
        records[existingIndex] = updated;
        writeRecords(records);
        return { status: "deduplicated", record: updated };
      }
      records.push(candidate);
      writeRecords(records);
      return { status: "added", record: candidate };
    });

  const list = (): Papercut[] =>
    withLock(() => removeExpired(readRecords()).sort((left, right) => left.expires.localeCompare(right.expires)));

  const close = (idPrefix: string): Papercut =>
    withLock(() => {
      const records = removeExpired(readRecords());
      const matches = records.filter((record) => record.id.startsWith(idPrefix));
      if (matches.length === 0) throw new Error(`no open papercut matches "${idPrefix}"`);
      if (matches.length > 1) throw new Error(`papercut prefix "${idPrefix}" is ambiguous`);
      const [closed] = matches;
      writeRecords(records.filter((record) => record.id !== closed.id));
      return closed;
    });

  return { record, list, close };
};

const detectRepositoryName = (): string => {
  if (process.env.PAPERCUTS_REPO?.trim()) return process.env.PAPERCUTS_REPO.trim();
  let directory = path.resolve(process.cwd());
  while (true) {
    const marker = path.join(directory, ".jj", "repo");
    if (fs.existsSync(marker)) {
      if (fs.statSync(marker).isDirectory()) return path.basename(directory);
      const reference = fs.readFileSync(marker, "utf8").trim();
      if (reference.length > 0) {
        const repositoryDirectory = path.resolve(path.dirname(marker), reference);
        return path.basename(path.dirname(path.dirname(repositoryDirectory)));
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return path.basename(process.cwd()) || "unknown";
};

const stateFile = path.resolve(
  process.env.PAPERCUTS_FILE || path.join(os.homedir(), ".local", "state", "papercuts.jsonl"),
);
const now = parseNow();
const api = createApi({ file: stateFile, now, repo: detectRepositoryName() });

const takeOption = (args: string[], name: string): string | null => {
  const index = args.indexOf(name);
  if (index < 0) return null;
  if (args.indexOf(name, index + 1) >= 0) throw new Error(`${name} may only appear once`);
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  args.splice(index, 2);
  return value;
};

const formatRemaining = (milliseconds: number): string => {
  const hours = Math.max(1, Math.ceil(milliseconds / HOUR_MS));
  return `${hours}h`;
};

const printHelp = (): void => {
  process.stdout.write(`papercuts — short-lived action inbox

Usage:
  papercuts add --where <target> --fix <action> [--ttl 24h|3d] <evidence>
  papercuts list [--format md|json]
  papercuts close <id>

Entries expire automatically. Default TTL is 3d; maximum is 7d.
`);
};

const run = (): void => {
  const [command, ...commandArgs] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "add") {
    const args = [...commandArgs];
    const where = takeOption(args, "--where");
    const fix = takeOption(args, "--fix");
    const ttl = takeOption(args, "--ttl");
    if (args.length !== 1) {
      throw new Error("Usage: papercuts add --where <target> --fix <action> [--ttl 24h|3d] <evidence>");
    }
    const result = api.record({ where: requiredText(where, "--where"), why: args[0], fix: requiredText(fix, "--fix"), ttlMs: parseTtl(ttl) });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (command === "list") {
    const args = [...commandArgs];
    const format = takeOption(args, "--format") || "md";
    if (args.length > 0 || (format !== "md" && format !== "json")) throw new Error("Usage: papercuts list [--format md|json]");
    const records = api.list();
    if (format === "json") {
      process.stdout.write(`${JSON.stringify(records)}\n`);
      return;
    }
    if (records.length === 0) {
      process.stdout.write("Nothing open.\n");
      return;
    }
    for (const record of records) {
      const remaining = formatRemaining(new Date(record.expires).getTime() - now.getTime());
      const recurrence = record.seen ? `; seen ${record.seen}x` : "";
      process.stdout.write(`- \`${record.id}\` ${record.repo}:${record.where} — ${record.why} → ${record.fix} (expires ${remaining})${recurrence}\n`);
    }
    return;
  }

  if (command === "close") {
    if (commandArgs.length !== 1) throw new Error("Usage: papercuts close <id>");
    process.stdout.write(`${JSON.stringify({ closed: api.close(commandArgs[0]).id })}\n`);
    return;
  }

  throw new Error(`unknown command "${command}"`);
};

try {
  run();
} catch (error) {
  process.stderr.write(`papercuts: ${error instanceof Error ? error.message : "unexpected error"}\n`);
  process.exitCode = 2;
}
