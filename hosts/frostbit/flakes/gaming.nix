{ ... }:
{
  flake.modules.homeManager.frostbitgames =
    { pkgs, ... }:
    {
      home.packages = [
        pkgs.modrinth-app
      ];
    };
}
