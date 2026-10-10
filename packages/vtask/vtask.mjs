#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { spawn } from "node:child_process";

const usage = `Usage: vtask [options] [label]

Options:
  --file <path>       Read tasks from an explicit tasks.json file
  --list              List runnable task labels
  --cwd <path>        Start discovery and task execution from this directory
  -h, --help          Show this help
`;

function parseArgs(argv) {
  const options = { file: null, list: false, cwd: process.cwd(), label: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--file":
        options.file = argv[++index];
        break;
      case "--cwd":
        options.cwd = argv[++index];
        break;
      case "--list":
        options.list = true;
        break;
      case "-h":
      case "--help":
        process.stdout.write(usage);
        process.exit(0);
        break;
      default:
        if (arg.startsWith("-")) throw new Error("Unknown option: " + arg);
        if (options.label !== null) throw new Error("Only one task label may be provided");
        options.label = arg;
    }
  }
  return options;
}

function stripJsonComments(text) {
  let output = "";
  let inString = false;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }
    if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index += 1;
      index += 1;
      continue;
    }
    output += char;
  }
  return output.replace(/,\s*([}\]])/g, "$1");
}

function discoverTasksFile(startDirectory) {
  let directory = path.resolve(startDirectory);
  while (true) {
    const candidate = path.join(directory, ".vscode", "tasks.json");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function loadTasks(file) {
  const text = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(stripJsonComments(text));
  const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  return tasks
    .filter((task) => typeof task.label === "string" && typeof task.command === "string")
    .map((task) => ({ ...task, sourceFile: file }));
}

function substitute(value, workspaceFolder, cwd) {
  return String(value)
    .replaceAll("${workspaceFolder}", workspaceFolder)
    .replaceAll("${workspaceFolderBasename}", path.basename(workspaceFolder))
    .replaceAll("${cwd}", cwd)
    .replaceAll("${userHome}", os.homedir())
    .replaceAll("${pathSeparator}", path.delimiter)
    .replaceAll("${/}", path.sep)
    .replace(/\$\{env:([^}]+)\}/g, (_match, name) => process.env[name] ?? "");
}

async function chooseTask(tasks) {
  if (!process.stdin.isTTY) throw new Error("Task label is required without an interactive terminal");
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    tasks.forEach((task, index) => {
      process.stdout.write(`${index + 1}. ${task.label}\n`);
    });
    const answer = await terminal.question("Task number: ");
    const selected = Number.parseInt(answer, 10);
    if (!Number.isInteger(selected) || selected < 1 || selected > tasks.length) {
      throw new Error("Invalid task selection");
    }
    return tasks[selected - 1];
  } finally {
    terminal.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const taskFile = options.file === null ? discoverTasksFile(options.cwd) : path.resolve(options.file);
  if (taskFile === null) throw new Error("No .vscode/tasks.json found");
  const tasks = loadTasks(taskFile);
  if (tasks.length === 0) throw new Error("No runnable shell/process tasks found in " + taskFile);

  if (options.list) {
    for (const task of tasks) process.stdout.write(task.label + "\n");
    return;
  }

  const task =
    options.label === null
      ? await chooseTask(tasks)
      : tasks.find((candidate) => candidate.label === options.label);
  if (task === undefined) throw new Error("Unknown task label: " + options.label);

  const workspaceFolder = path.dirname(path.dirname(taskFile));
  const cwd = path.resolve(
    workspaceFolder,
    task.options?.cwd === undefined ? "." : substitute(task.options.cwd, workspaceFolder, options.cwd),
  );
  const command = substitute(task.command, workspaceFolder, cwd);
  const args = (Array.isArray(task.args) ? task.args : []).map((arg) => substitute(arg, workspaceFolder, cwd));
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...(task.options?.env ?? {}) },
    shell: task.type !== "process",
    stdio: "inherit",
  });
  const code = await new Promise((resolve) => child.on("close", resolve));
  process.exitCode = code ?? 1;
}

main().catch((error) => {
  process.stderr.write("vtask: " + (error instanceof Error ? error.message : String(error)) + "\n");
  process.exitCode = 1;
});
