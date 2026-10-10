import { PrefetchResultSchema, UrlSchema, VersionSchema, z } from "../update-schema.ts";

const sources = {
  "x86_64-linux": { suffix: "-linux-x86_64.AppImage" },
} as const;

function commandOutput(command: string[], cwd?: string): string {
  const result = Bun.spawnSync(command, { cwd });
  if (!result.success) {
    throw new Error("Command failed: " + command.join(" "));
  }
  return new TextDecoder().decode(result.stdout).trim();
}

function prefetchHash(url: string, root: string): string {
  const validUrl = UrlSchema.parse(url);
  const output = commandOutput(["nix", "store", "prefetch-file", "--json", validUrl], root);
  return PrefetchResultSchema.parse(JSON.parse(output)).hash;
}

async function latestRelease(): Promise<{ tag: string; assetsHtml: string }> {
  const response = await fetch(
    "https://github.com/marcomorosi06/WiFiAudioStreaming-Desktop/releases/latest",
    { headers: { "User-Agent": "nix-update" } },
  );
  if (!response.ok) {
    throw new Error("Could not read WiFi Audio Streaming releases: HTTP " + response.status);
  }

  const tag = new URL(UrlSchema.parse(response.url)).pathname.split("/").at(-1);
  if (tag === undefined || tag === "" || tag === "latest") {
    throw new Error("Could not resolve the latest WiFi Audio Streaming release tag");
  }
  z.string().regex(/^v\d+\.\d+(?:\.\d+)?(?:-[\w.-]+)?$/).parse(tag);

  const assetsUrl = UrlSchema.parse(
    "https://github.com/marcomorosi06/WiFiAudioStreaming-Desktop/releases/expanded_assets/" + tag,
  );
  const assetsResponse = await fetch(assetsUrl, { headers: { "User-Agent": "nix-update" } });
  if (!assetsResponse.ok) {
    throw new Error("Could not read release assets for " + tag + ": HTTP " + assetsResponse.status);
  }

  return { tag, assetsHtml: await assetsResponse.text() };
}

const root = commandOutput(["git", "rev-parse", "--show-toplevel"]);
const packageFile = root + "/packages/wifi-audio-streaming/default.nix";
let packageText = await Bun.file(packageFile).text();
const currentVersion = packageText.match(/^    version = "([^"]+)";$/m)?.[1];
const currentTag = packageText.match(/^    releaseTag = "([^"]+)";$/m)?.[1];
if (currentVersion === undefined || currentTag === undefined) {
  throw new Error("Could not read the current version and release tag from " + packageFile);
}
VersionSchema.parse(currentVersion);

const release = await latestRelease();
const assetLinks = Array.from(
  release.assetsHtml.matchAll(
    /href="([^" ]*\/releases\/download\/([^/]+)\/(WiFi-Audio-Streaming-[^"? ]+))"/g,
  ),
).map((match) => ({ url: "https://github.com" + match[1], tag: match[2], name: match[3] }));

let version: string | undefined;
for (const [system, source] of Object.entries(sources)) {
  const assetLink = assetLinks.find(
    (candidate) =>
      candidate.tag === release.tag &&
      candidate.name.startsWith("WiFi-Audio-Streaming-") &&
      candidate.name.endsWith(source.suffix),
  );
  if (assetLink === undefined) {
    throw new Error("Could not find the " + system + " asset in " + release.tag);
  }

  const assetPrefix = "WiFi-Audio-Streaming-";
  const platformVersion = assetLink.name.slice(assetPrefix.length, -source.suffix.length);
  VersionSchema.parse(platformVersion);
  if (version !== undefined && version !== platformVersion) {
    throw new Error("WiFi Audio Streaming release assets disagree on their version");
  }
  version = platformVersion;

  const hash = prefetchHash(UrlSchema.parse(assetLink.url), root);
  const sourceBlock = new RegExp('("' + system + '" = \\{[\\s\\S]*?hash = ")[^"]+(";)');
  if (!sourceBlock.test(packageText)) {
    throw new Error("Could not find the " + system + " source block in " + packageFile);
  }
  packageText = packageText.replace(sourceBlock, "$1" + hash + "$2");
  console.log("wifi-audio-streaming " + system + ": " + hash);
}

if (version === undefined) {
  throw new Error("Could not determine the WiFi Audio Streaming release version");
}

packageText = packageText.replace(/^    version = "[^"]+";$/m, '    version = "' + version + '";');
packageText = packageText.replace(/^    releaseTag = "[^"]+";$/m, '    releaseTag = "' + release.tag + '";');

const temporaryPath = packageFile + "." + crypto.randomUUID() + ".tmp";
await Bun.write(temporaryPath, packageText);
const move = Bun.spawnSync(["mv", temporaryPath, packageFile]);
if (!move.success) throw new Error("Could not replace " + packageFile);
console.log("Updated " + packageFile + " to " + version + " (" + release.tag + ").");
