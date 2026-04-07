{ inputs, ... }:
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
    { lib, config, ... }:
    {
      imports = [
        inputs.noctalia.homeModules.default
      ];

      programs.noctalia-shell = {
        enable = true;
        settings = {
          bar = {
            density = lib.mkDefault "comfortable";
            position = lib.mkDefault "left";
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
          dock.enable = lib.mkDefault false;
          wallpaper.enabled = lib.mkDefault false;
          general = {
            avatarImage = "/home/${config.home.username}/.face";
            radiusRatio = lib.mkDefault 0.2;
          };
          appLauncher = {
            position = lib.mkDefault "center";
            viewMode = lib.mkDefault "list";
            terminalCommand = lib.mkDefault "kitty -e";
          };
        };
      };
    };
}
