{ ... }:
{
  flake.modules.homeManager.utility-apps =
    { pkgs, ... }:
    {
      home.packages = with pkgs; [
        bitwig-studio
        obsidian
        pi-coding-agent
        qdirstat
        dust
        kdePackages.dolphin
        libation
        nemo
        vlc
        wl-clipboard
        zip
      ];

      home.file."Cabinet/.keep".text = "";
    };
}
