{ ... }:
{
  flake.modules.homeManager.wine =
    { pkgs, ... }:
    {
      home.packages = [
        pkgs.wineWow64Packages.waylandFull
        pkgs.winetricks
      ];
    };
}
