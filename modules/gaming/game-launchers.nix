{ ... }:
{
  flake.modules.homeManager.game-launchers =
    { pkgs, ... }:
    {
      home.packages = [
        pkgs.protonup-qt
        pkgs.protonplus
        pkgs.heroic
        pkgs.lutris
        pkgs.bottles
        pkgs.umu-launcher
      ];
    };
}
