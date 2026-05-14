{ ... }:
{
  flake.modules.homeManager.utility-apps =
    { pkgs, ... }:
    {
      home.packages = with pkgs; [
        qdirstat
        dust
        nemo
        vlc
        zip
      ];
    };
}
