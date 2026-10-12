{ inputs, ... }:
let
  package =
    inputs.nixpkgs.legacyPackages.x86_64-linux.callPackage ../packages/keep-awake-mcp/default.nix
      { };
in
{
  flake.packages.x86_64-linux.keep-awake-mcp = package;
  flake.checks.x86_64-linux.keep-awake-mcp = package;
  flake.modules.homeManager.keepAwake =
    { pkgs, ... }:
    {
      home.packages = [ (pkgs.callPackage ../packages/keep-awake-mcp/default.nix { }) ];
    };
}
