{ inputs, ... }:
{
  flake.modules.nixos.spotifast =
    { pkgs, ... }:
    {
      environment.systemPackages = [
        inputs.spotifast.packages.${pkgs.stdenv.hostPlatform.system}.default
      ];
    };
}
