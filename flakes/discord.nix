{ inputs, ... }:
{
  flake.modules.homeManager.discord =
    { pkgs, ... }:
    let
      discordPkgs = import inputs.nixpkgs-discord {
        system = pkgs.stdenv.hostPlatform.system;
        config.allowUnfree = true;
      };
    in
    {
      home.packages = [ discordPkgs.discord ];
    };
}
