{ ... }:
{
  flake.modules.homeManager.utility-apps =
    { pkgs, ... }:
    {
      home.packages = with pkgs; [
        obsidian
        pi-coding-agent
        qdirstat
        dust
        libation
        losslesscut-bin
        # nemo
        vlc
        wl-clipboard
        zip
      ];

      home.file."Cabinet/.keep".text = "";
    };
}
