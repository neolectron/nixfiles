{ ... }:
{
  flake.modules.homeManager.frostbitgames =
    { pkgs, ... }:
    {
      home.packages = [
        pkgs.modrinth-app
        pkgs.protonup-qt
        pkgs.protonplus
        pkgs.heroic
        pkgs.lutris
        pkgs.bottles
        pkgs.umu-launcher
      ];
    };
}
