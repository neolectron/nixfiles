import { expect, test } from "bun:test";
import { updateCodeBurnPackageText } from "./update.ts";

const sourceHash = "sha256-CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=";
const npmIntegrity = "sha512-DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD==";

const packageText = `  version = "0.1.0";

  src = fetchFromGitHub {
    hash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  };

  npmArtifact = fetchurl {
    hash = "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
  };

  npmDepsHash = "sha256-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";
`;

test("updates version, source hash, and npm artifact hash together", () => {
  const nextText = updateCodeBurnPackageText(packageText, {
    version: "1.2.3",
    sourceHash,
    npmIntegrity,
  });

  expect(nextText).toContain('version = "1.2.3";');
  expect(nextText).toContain('hash = "' + sourceHash + '";');
  expect(nextText).toContain('hash = "' + npmIntegrity + '";');
  expect(nextText).toContain('npmDepsHash = "sha256-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";');
});

test("fails instead of silently skipping missing source hash anchor", () => {
  expect(() =>
    updateCodeBurnPackageText('  version = "0.1.0";\n', {
      version: "1.2.3",
      sourceHash,
      npmIntegrity,
    }),
  ).toThrow("source hash");
});
