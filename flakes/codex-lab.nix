{ inputs, ... }:
{
  flake.packages.x86_64-linux.codex-lab-mcp =
    inputs.nixpkgs.legacyPackages.x86_64-linux.callPackage ../packages/codex-lab-mcp/default.nix { };
}
