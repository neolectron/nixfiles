{ inputs, config, ... }:
let
  username = config.flake.username;
in
{
  # NixOS side: enable services noctalia benefits from
  flake.modules.nixos.noctalia =
    { ... }:
    {
      # Power profiles for the power widget
      services.power-profiles-daemon.enable = true;
      # Battery info for battery widget
      services.upower.enable = true;
    };

  # Home Manager side: noctalia shell config
  flake.modules.homeManager.noctalia =
    { pkgs, ... }:
    {
      imports = [
        inputs.noctalia.homeModules.default
      ];

      programs.noctalia-shell = {
        enable = true;
        settings = {
          bar = {
            density = "comfortable";
            position = "left";
            widgets = {
              left = [
                {
                  id = "ControlCenter";
                  useDistroLogo = true;
                }
                {
                  id = "Network";
                }
              ];
              center = [
                {
                  id = "Workspace";
                  hideUnoccupied = false;
                  labelMode = "none";
                }
              ];
              right = [
                {
                  id = "Volume";
                }
                {
                  id = "Microphone";
                }
                {
                  id = "Clock";
                  formatHorizontal = "HH:mm";
                  formatVertical = "HH mm";
                  useMonospacedFont = true;
                  usePrimaryColor = true;
                }
                {
                  id = "Tray";
                }
              ];
            };
          };
          dock.enable = false;
          wallpaper.enabled = false;
          general = {
            avatarImage = "/home/${username}/.face";
            radiusRatio = 0.2;
          };
          appLauncher = {
            position = "center";
            viewMode = "list";
            terminalCommand = "kitty -e";
          };
        };
      };
    };
}
