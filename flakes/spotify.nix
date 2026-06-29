{ ... }:
{
  # Home Manager side: Spotify
  flake.modules.homeManager.spotify =
    { pkgs, ... }:
    {
      home.packages = with pkgs; [
        spotify
      ];

      xdg.mimeApps = {
        enable = true;
        defaultApplications = {
          "x-scheme-handler/spotify" = "spotify.desktop";
        };
      };
    };
}
