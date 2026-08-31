{ inputs, ... }:
{
  flake.apps.x86_64-linux.update-flake-inputs =
    let
      pkgs = inputs.nixpkgs.legacyPackages.x86_64-linux;
    in
    {
      type = "app";
      program = "${
        pkgs.writeShellApplication {
          name = "update-flake-inputs";
          runtimeInputs = [
            pkgs.git
            pkgs.jq
            pkgs.nix
          ];
          text = ''
            exec ${../scripts/update-flake-inputs} "$@"
          '';
        }
      }/bin/update-flake-inputs";
    };
}
