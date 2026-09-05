import { $ } from "bun";
import { parseArgs } from "util";

type Command = string[];

type UpdateEntry = {
  name: string;
  type: string;
  description?: string;
  enabled?: boolean;
  systems?: string[];
  command: Command;
};

type ValidationEntry = {
  name: string;
  command: Command;
  systems?: string[];
};

type UpdateConfig = {
  updates: UpdateEntry[];
  validations?: Record<string, ValidationEntry[]>;
};

type Options = {
  dryRun: boolean;
  list: boolean;
  only: Set<string> | null;
  skip: Set<string>;
  validate: string | null;
};

type Result = {
  name: string;
  status: "ok" | "failed" | "skipped";
  reason?: string;
  code?: number;
};

function usage(): string {
  return `Usage: update-pins [options]

Through the flake app:
  nix run .#update-pins -- [options]

Options:
  --dry-run              Print selected commands without running them.
  --only <a,b>           Run only the named entries; may be repeated.
  --skip <a,b>           Skip the named entries; may be repeated.
  --validate <name>      Run a validation set after successful updates.
  --list                 List configured updates and validation sets.
  -h, --help             Show this help.
`;
}

function parseNameList(value: string): string[] {
  return value
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

function stringValues(value: string | string[] | boolean | undefined): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value;
  return [];
}

function parseOptions(argv: string[]): Options | "help" {
  const { values } = parseArgs({
    args: argv,
    options: {
      "dry-run": { type: "boolean", default: false },
      only: { type: "string", multiple: true },
      skip: { type: "string", multiple: true },
      validate: { type: "string" },
      list: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help === true) return "help";

  const only = stringValues(values.only).flatMap(parseNameList);
  const skip = stringValues(values.skip).flatMap(parseNameList);
  return {
    dryRun: values["dry-run"] === true,
    list: values.list === true,
    only: only.length > 0 ? new Set(only) : null,
    skip: new Set(skip),
    validate: typeof values.validate === "string" ? values.validate : null,
  };
}

async function repoRoot(): Promise<string> {
  if (Bun.env.UPDATE_PINS_REPO_ROOT) return Bun.env.UPDATE_PINS_REPO_ROOT;
  return (await $`git rev-parse --show-toplevel`.text()).trim();
}

function repoPath(root: string, ...segments: string[]): string {
  return `${root.replace(/\/+$/, "")}/${segments.join("/")}`;
}

async function loadConfig(root: string): Promise<UpdateConfig> {
  return await Bun.file(repoPath(root, "scripts", "update-pins.json")).json();
}

async function currentSystem(): Promise<string> {
  return (await $`nix eval --impure --raw --expr builtins.currentSystem`.text()).trim();
}

function unsupportedSystem(entry: { systems?: string[] }, system: string): string | null {
  if (entry.systems === undefined || entry.systems.includes(system)) return null;
  return `unsupported on ${system}`;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@%+,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function formatCommand(command: Command): string {
  return command.map(shellQuote).join(" ");
}

function selectedEntries(config: UpdateConfig, options: Options, system: string): Result[] {
  return config.updates.flatMap((entry) => {
    const unsupported = unsupportedSystem(entry, system);
    if (options.only !== null && !options.only.has(entry.name)) {
      return [{ name: entry.name, status: "skipped", reason: "not selected" }];
    }
    if (options.skip.has(entry.name)) {
      return [{ name: entry.name, status: "skipped", reason: "skipped by CLI" }];
    }
    if (entry.enabled === false) {
      return [{ name: entry.name, status: "skipped", reason: "disabled" }];
    }
    if (unsupported !== null) {
      return [{ name: entry.name, status: "skipped", reason: unsupported }];
    }
    return [];
  });
}

function runnableEntries(config: UpdateConfig, options: Options, system: string): UpdateEntry[] {
  return config.updates.filter((entry) => {
    if (options.only !== null && !options.only.has(entry.name)) return false;
    if (options.skip.has(entry.name) || entry.enabled === false) return false;
    return unsupportedSystem(entry, system) === null;
  });
}

async function runCommand(
  name: string,
  command: Command,
  cwd: string,
  dryRun: boolean,
): Promise<Result> {
  console.log(`\n==> ${name}`);
  console.log(formatCommand(command));
  if (dryRun) return { name, status: "skipped", reason: "dry run" };

  const proc = Bun.spawn(command, {
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  return code === 0
    ? { name, status: "ok" }
    : { name, status: "failed", code };
}

function printList(config: UpdateConfig): void {
  console.log("Updates:");
  for (const entry of config.updates) {
    const systems = entry.systems === undefined ? "all systems" : entry.systems.join(", ");
    const state = entry.enabled === false ? ", disabled" : "";
    console.log(
      `- ${entry.name} (${entry.type}${state}, ${systems}): ${entry.description ?? formatCommand(entry.command)}`,
    );
  }

  console.log("\nValidation sets:");
  for (const [name, entries] of Object.entries(config.validations ?? {})) {
    console.log(`- ${name}: ${entries.map((entry) => entry.name).join(", ")}`);
  }
}

function printSummary(results: Result[]): void {
  console.log("\nSummary:");
  for (const result of results.filter((item) => item.status === "ok")) {
    console.log(`  ok      ${result.name}`);
  }
  for (const result of results.filter((item) => item.status === "skipped")) {
    console.log(`  skipped ${result.name}${result.reason ? ` (${result.reason})` : ""}`);
  }
  for (const result of results.filter((item) => item.status === "failed")) {
    console.log(`  failed  ${result.name}${result.code === undefined ? "" : ` (exit ${result.code})`}`);
  }
}

async function main(): Promise<void> {
  let options: Options;
  try {
    const parsed = parseOptions(Bun.argv.slice(2));
    if (parsed === "help") {
      await Bun.write(Bun.stdout, usage());
      return;
    }
    options = parsed;
  } catch (error) {
    await Bun.write(Bun.stderr, `${error instanceof Error ? error.message : String(error)}\n${usage()}`);
    process.exitCode = 2;
    return;
  }

  const root = await repoRoot();
  const config = await loadConfig(root);
  const knownNames = new Set(config.updates.map((entry) => entry.name));
  const requestedNames = [...(options.only ?? []), ...options.skip];
  const unknownNames = [...new Set(requestedNames.filter((name) => !knownNames.has(name)))].sort();
  if (unknownNames.length > 0) {
    await Bun.write(Bun.stderr, `Unknown update entries: ${unknownNames.join(", ")}\n`);
    process.exitCode = 2;
    return;
  }

  if (options.list) {
    printList(config);
    return;
  }

  const system = await currentSystem();
  const results = selectedEntries(config, options, system);
  const runnable = runnableEntries(config, options, system);

  if (options.only !== null && runnable.length === 0) {
    printSummary(results);
    await Bun.write(
      Bun.stderr,
      "None of the explicitly selected updates are runnable; validation was not run. Check --list and the update registry.\n",
    );
    process.exitCode = 2;
    return;
  }

  for (const entry of runnable) {
    results.push(await runCommand(entry.name, entry.command, root, options.dryRun));
  }

  const failed = results.some((result) => result.status === "failed");
  if (!failed && options.validate !== null) {
    const validations = config.validations?.[options.validate];
    if (validations === undefined) {
      await Bun.write(Bun.stderr, `Unknown validation set: ${options.validate}\n`);
      process.exitCode = 2;
      return;
    }
    for (const entry of validations) {
      const unsupported = unsupportedSystem(entry, system);
      if (unsupported !== null) {
        results.push({ name: `validate:${entry.name}`, status: "skipped", reason: unsupported });
      } else {
        results.push(await runCommand(`validate:${entry.name}`, entry.command, root, options.dryRun));
      }
    }
  }

  printSummary(results);
  if (results.some((result) => result.status === "failed")) process.exitCode = 1;
}

await main();
