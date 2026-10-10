import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const scriptPath = resolve(import.meta.dir, "update-pins.ts");
const repoRoot = resolve(import.meta.dir, "..");

function run(args: string[]) {
  return spawnSync("bun", [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, UPDATE_PINS_REPO_ROOT: repoRoot },
  });
}

test("unknown --only entries fail before running an update", () => {
  const result = run(["--only", "__unknown_update_entry__", "--dry-run"]);

  expect(result.status).toBe(2);
  expect(result.stderr).toContain("Unknown update entries: __unknown_update_entry__");
  expect(result.stdout).toBe("");
});

test("unknown validation sets fail before running an update", () => {
  const result = run(["--validate", "__unknown_validation__", "--dry-run"]);

  expect(result.status).toBe(2);
  expect(result.stderr).toContain("Unknown validation set: __unknown_validation__");
  expect(result.stdout).toBe("");
});

test("denylisted entries require an explicit override", () => {
  const skipped = run(["--only", "opencodex", "--dry-run"]);
  expect(skipped.status).toBe(2);
  expect(skipped.stdout).toContain("skipped opencodex (denylisted)");

  const included = run(["--only", "opencodex", "--include-denylisted", "--dry-run"]);
  expect(included.status).toBe(0);
  expect(included.stdout).toContain("nix run github:Mic92/nix-update -- --flake opencodex --use-update-script");
});
