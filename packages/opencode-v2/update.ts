import { SriHashSchema, UrlSchema, VersionSchema, z } from "../update-schema.ts";

const LatestReleaseSchema = z
  .object({
    version: z.string().optional(),
    metadata: z.object({ package: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();
const NpmPackageSchema = z
  .object({ dist: z.object({ integrity: SriHashSchema.optional() }).passthrough().optional() })
  .passthrough();

async function fetchJson(url: string): Promise<unknown> {
  const validUrl = UrlSchema.parse(url);
  const response = await fetch(validUrl);
  if (!response.ok) {
    throw new Error(`Could not fetch ${validUrl}: HTTP ${response.status}`);
  }
  return await response.json();
}

const latestUrl = "https://opencode.ai/update/api/latest/cli/npm";
const latest = LatestReleaseSchema.parse(await fetchJson(latestUrl));
if (latest.version === undefined || latest.version === "") {
  throw new Error(`Could not determine the latest OpenCode V2 version from ${latestUrl}`);
}
VersionSchema.parse(latest.version);

const packageScope = latest.metadata?.package;
if (packageScope === undefined || packageScope === "") {
  throw new Error(`Could not determine the OpenCode V2 npm package from ${latestUrl}`);
}
z.string().regex(/^@[a-z0-9._-]+\/[a-z0-9._-]+$/i).parse(packageScope);

const packageName = `${packageScope}-linux-x64`;
const metadata = NpmPackageSchema.parse(
  await fetchJson(`https://registry.npmjs.org/${packageName.replace("/", "%2f")}/${latest.version}`),
);
const integrity = metadata.dist?.integrity;
if (integrity === undefined) {
  throw new Error(`Could not read the release integrity hash for ${packageName}@${latest.version}`);
}

const rootResult = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"]);
if (!rootResult.success) throw new Error("Could not determine the repository root");
const root = new TextDecoder().decode(rootResult.stdout).trim();
const packageFile = `${root}/packages/opencode-v2/default.nix`;
let packageText = await Bun.file(packageFile).text();

const currentVersion = packageText.match(/^  version = "([^"]+)";$/m)?.[1];
if (currentVersion === undefined) throw new Error(`Could not read the current version from ${packageFile}`);
VersionSchema.parse(currentVersion);

console.log(`opencode-v2 current: ${currentVersion}`);
console.log(`opencode-v2 latest:  ${latest.version}`);

packageText = packageText.replace(/^(  version = ")[^"]+(";)$/m, `$1${latest.version}$2`);
packageText = packageText.replace(/^(    hash = ")[^"]+(";)$/m, `$1${SriHashSchema.parse(integrity)}$2`);

const temporaryPath = packageFile + "." + crypto.randomUUID() + ".tmp";
await Bun.write(temporaryPath, packageText);
const move = Bun.spawnSync(["mv", temporaryPath, packageFile]);
if (!move.success) throw new Error(`Could not replace ${packageFile}`);
console.log(`Updated ${packageFile}`);
