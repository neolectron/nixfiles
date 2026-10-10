import { PrefetchResultSchema, Sha256HashSchema, UrlSchema, VersionSchema, z } from "../update-schema.ts";

const RegistryReleaseSchema = z
  .object({
    version: VersionSchema,
    dist: z.object({ tarball: UrlSchema }).passthrough(),
  })
  .passthrough();

export function extractDependencyHash(output: string): string {
  const matches = Array.from(output.matchAll(/got:\s*(sha256-[A-Za-z0-9+/]{43}=)/g));
  if (matches.length !== 1) {
    throw new Error("Could not determine exactly one OpenCodex dependency hash from Nix output");
  }
  return Sha256HashSchema.parse(matches[0][1]);
}

function commandOutput(command: string[], cwd: string): string {
  const result = Bun.spawnSync(command, { cwd });
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  if (!result.success) {
    throw new Error("Command failed: " + command.join(" ") + "\n" + stdout + stderr);
  }
  return stdout.trim();
}

async function prefetchHash(url: string, root: string): Promise<string> {
  const output = commandOutput(["nix", "store", "prefetch-file", "--json", UrlSchema.parse(url)], root);
  return PrefetchResultSchema.parse(JSON.parse(output)).hash;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(UrlSchema.parse(url));
  if (!response.ok) {
    throw new Error(`Could not fetch ${url}: HTTP ${response.status}`);
  }
  return await response.json();
}

if (import.meta.main) {
  const root = commandOutput(["git", "rev-parse", "--show-toplevel"], process.cwd());
  const packageFile = root + "/packages/opencodex/default.nix";
  const originalText = await Bun.file(packageFile).text();
  let packageText = originalText;
  const currentVersion = packageText.match(/^  version = "([^"]+)";$/m)?.[1];
  if (currentVersion === undefined) {
    throw new Error(`Could not read the current version from ${packageFile}`);
  }
  VersionSchema.parse(currentVersion);

  const release = RegistryReleaseSchema.parse(
    await fetchJson("https://registry.npmjs.org/@bitkyc08%2fopencodex/latest"),
  );
  const version = release.version;
  console.log(`opencodex current: ${currentVersion}`);
  console.log(`opencodex latest:  ${version}`);

  const sourceHash = await prefetchHash(release.dist.tarball, root);
  const bunLockHash = await prefetchHash(
    `https://raw.githubusercontent.com/lidge-jun/opencodex/v${version}/bun.lock`,
    root,
  );
  const placeholderHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

  packageText = packageText
    .replace(/^(  version = ")[^"]+(";)$/m, `$1${version}$2`)
    .replace(/^(    hash = ")[^"]+(";\n  };\n\n  bunLock =)/m, `$1${sourceHash}$2`)
    .replace(/^(    hash = ")[^"]+(";\n  };\n\n  bunDeps =)/m, `$1${bunLockHash}$2`)
    .replace(/^(    outputHash = ")[^"]+(";)$/m, `$1${placeholderHash}$2`);

  try {
    await Bun.write(packageFile, packageText);
    const build = Bun.spawnSync(["nix", "build", ".#opencodex", "--no-link"], { cwd: root });
    const output = new TextDecoder().decode(build.stdout) + "\n" + new TextDecoder().decode(build.stderr);
    if (build.success) {
      throw new Error("OpenCodex dependency build unexpectedly succeeded with the placeholder hash");
    }
    const dependencyHash = extractDependencyHash(output);
    packageText = packageText.replace(/^(    outputHash = ")[^"]+(";)$/m, `$1${dependencyHash}$2`);
    await Bun.write(packageFile, packageText);
    console.log(`Updated ${packageFile}`);
  } catch (error) {
    await Bun.write(packageFile, originalText);
    throw error;
  }
}
