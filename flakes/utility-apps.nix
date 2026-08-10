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
        libation
        # nemo
        vlc
        wl-clipboard
        zip
      ];

      home.file."Cabinet/.keep".text = "";
    };
}
