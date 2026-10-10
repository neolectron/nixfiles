import { expect, test } from "bun:test";
import { extractDependencyHash } from "./update.ts";

test("extracts a single Nix fixed-output dependency hash", () => {
  const output = `error: hash mismatch in fixed-output derivation '/nix/store/example.drv':
         specified: sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
            got:    sha256-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=`;

  expect(extractDependencyHash(output)).toBe("sha256-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=");
});

test("rejects ambiguous dependency hash output", () => {
  expect(() =>
    extractDependencyHash(
      "got: sha256-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=\ngot: sha256-CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=",
    ),
  ).toThrow();
});
