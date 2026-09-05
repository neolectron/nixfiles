{ inputs, ... }:
{
  flake.packages.x86_64-linux.codeburn =
    inputs.nixpkgs.legacyPackages.x86_64-linux.callPackage ../packages/codeburn
      { };
}
