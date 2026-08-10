{ ... }:
{
  flake.modules.homeManager.dolphin =
    { pkgs, ... }:
    {
      home.packages = [ pkgs.kdePackages.dolphin ];
    };
}
