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
        nemo
        vlc
        zip
      ];

      home.file."Cabinet/.keep".text = "";
    };
}
