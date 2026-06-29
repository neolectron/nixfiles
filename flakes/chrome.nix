{ ... }:
{
  flake.modules.homeManager.google-chrome =
    { pkgs, ... }:
    {
      home.packages = [ pkgs.google-chrome ];

      # Register spotify:// protocol handler so Chrome allows external app launches
      xdg.configFile."google-chrome/policies/managed/spotify-protocol.json".text =
        builtins.toJSON {
          AutoLaunchProtocolsFromOrigins = [
            {
              protocol = "spotify";
              allowed_origins = [ "https://open.spotify.com" "https://spotify.link" ];
            }
          ];
          ExternalProtocolDialogShowAlwaysOpenCheckbox = true;
        };
    };
}
