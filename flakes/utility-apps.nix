{ ... }:
{
  flake.modules.homeManager.utility-apps =
    { pkgs, ... }:
    {
      home.packages = with pkgs; [
        qdirstat
        gparted
        dust
        nemo
      ];
    };
}
