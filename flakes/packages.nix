{ inputs, ... }:
{
  flake.packages.x86_64-linux.codeburn =
    inputs.nixpkgs.legacyPackages.x86_64-linux.callPackage ../packages/codeburn
      { };

  flake.packages.x86_64-linux.humanlayer-cli =
    inputs.nixpkgs.legacyPackages.x86_64-linux.callPackage ../packages/humanlayer-cli
      { };

  flake.packages.x86_64-linux.node-global-packages =
    inputs.nixpkgs.legacyPackages.x86_64-linux.callPackage ../packages/node-global-packages
      { };
}
