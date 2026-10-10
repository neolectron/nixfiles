import { PrefetchResultSchema, SriHashSchema, UrlSchema, VersionSchema, z } from "../update-schema.ts";

const NpmPackageSchema = z
  .object({
    version: VersionSchema.optional(),
    dist: z.object({ integrity: SriHashSchema.optional() }).passthrough().optional(),
  })
  .passthrough();

function commandOutput(command: string[], cwd?: string): string {
  const result = Bun.spawnSync(command, { cwd });
  if (!result.success) {
    throw new Error("Command failed: " + command.join(" "));
  }
  return new TextDecoder().decode(result.stdout).trim();
}

async function fetchNpmPackage(name: string): Promise<{ version?: string; dist?: { integrity?: string } }> {
  const response = await fetch(UrlSchema.parse(`https://registry.npmjs.org/${name}`));
  if (!response.ok) {
    throw new Error(`Could not fetch ${name}: HTTP ${response.status}`);
  }
  return NpmPackageSchema.parse(await response.json());
}

async function prefetchHash(url: string, root: string, unpack = false): Promise<string> {
  const arguments_ = ["nix", "store", "prefetch-file", "--json"];
  if (unpack) arguments_.push("--unpack");
  arguments_.push(UrlSchema.parse(url));
  const result = Bun.spawnSync(arguments_, { cwd: root });
  if (!result.success) {
    throw new Error("Could not prefetch " + url);
  }
  return PrefetchResultSchema.parse(JSON.parse(new TextDecoder().decode(result.stdout))).hash;
}

export function replaceRequired(
  text: string,
  pattern: RegExp,
  replacement: string,
  field: string,
): string {
  if (!pattern.test(text)) {
    throw new Error(`Could not update ${field} in the CodeBurn package definition`);
  }
  return text.replace(pattern, replacement);
}

export function updateCodeBurnPackageText(
  packageText: string,
  options: { version: string; sourceHash: string; npmIntegrity: string },
): string {
  VersionSchema.parse(options.version);
  PrefetchResultSchema.parse({ hash: options.sourceHash });
  SriHashSchema.parse(options.npmIntegrity);

  let nextText = replaceRequired(
    packageText,
    /^(  version = ")[^"]+(";)$/m,
    "$1" + options.version + "$2",
    "version",
  );
  nextText = replaceRequired(
    nextText,
    /^(    hash = ")[^"]+(";\n  };\n\n  npmArtifact = fetchurl)/m,
    "$1" + options.sourceHash + "$2",
    "source hash",
  );
  nextText = replaceRequired(
    nextText,
    /^(    hash = ")[^"]+(";\n  };\n\n  npmDepsHash)/m,
    "$1" + options.npmIntegrity + "$2",
    "npm artifact hash",
  );
  return nextText;
}

async function writeAtomic(filePath: string, text: string): Promise<void> {
  const temporaryPath = filePath + "." + crypto.randomUUID() + ".tmp";
  await Bun.write(temporaryPath, text);
  const move = Bun.spawnSync(["mv", temporaryPath, filePath]);
  if (!move.success) throw new Error("Could not replace " + filePath);
}

if (import.meta.main) {
  const latest = await fetchNpmPackage("codeburn/latest");
  if (latest.version === undefined || latest.version === "") {
    throw new Error("Could not determine the latest CodeBurn version");
  }

  const npmIntegrity = latest.dist?.integrity;
  if (npmIntegrity === undefined) {
    throw new Error("Could not read the npm integrity hash for codeburn@" + latest.version);
  }

  const root = commandOutput(["git", "rev-parse", "--show-toplevel"]);
  const packageFile = root + "/packages/codeburn/default.nix";
  const packageText = await Bun.file(packageFile).text();
  const currentVersion = packageText.match(/^  version = "([^"]+)";$/m)?.[1];
  if (currentVersion === undefined) {
    throw new Error(`Could not read the current version from ${packageFile}`);
  }

  console.log("codeburn current: " + currentVersion);
  console.log("codeburn latest:  " + latest.version);

  const sourceUrl =
    "https://github.com/getagentseal/codeburn/archive/refs/tags/v" + latest.version + ".tar.gz";
  const sourceHash = await prefetchHash(sourceUrl, root, true);
  const nextText = updateCodeBurnPackageText(packageText, {
    version: latest.version,
    sourceHash,
    npmIntegrity,
  });

  await writeAtomic(packageFile, nextText);
  console.log("Updated " + packageFile);

  const updateDeps = Bun.spawnSync([
    "nix",
    "run",
    "github:Mic92/nix-update",
    "--",
    "--flake",
    "codeburn",
    "--version",
    "skip",
    "--no-src",
  ]);
  if (!updateDeps.success) {
    throw new Error("Could not update CodeBurn's npm dependency hash");
  }
  process.stdout.write(new TextDecoder().decode(updateDeps.stdout));
  process.stderr.write(new TextDecoder().decode(updateDeps.stderr));
}
