{ inputs, ... }:
{
  flake.apps.x86_64-linux.update-pins =
    let
      pkgs = inputs.nixpkgs.legacyPackages.x86_64-linux;
    in
    {
      type = "app";
      program = "${
        pkgs.writeShellApplication {
          name = "update-pins";
          runtimeInputs = [
            pkgs.bun
            pkgs.git
            pkgs.jq
            pkgs.nix
          ];
          text = ''
            exec ${pkgs.bun}/bin/bun ${../scripts/update-pins.ts} "$@"
          '';
        }
      }/bin/update-pins";
      meta.description = "Update registered package pins and flake inputs";
    };
}
