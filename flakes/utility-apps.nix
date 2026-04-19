{ ... }:
{
  flake.modules.homeManager.utility-apps =
    { pkgs, ... }:
    {
      home.packages = [
        pkgs.qdirstat
        pkgs.gparted
        pkgs.dust
      ];
    };
}
