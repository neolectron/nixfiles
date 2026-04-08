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
    {
      lib,
      pkgs,
      config,
      ...
    }:
    {
      imports = [
        inputs.noctalia.homeModules.default
      ];

      # fastfetch: used by noctalia's system info integration
      home.packages = [ pkgs.fastfetch ];

      programs.noctalia-shell = {
        enable = true;
        settings = {
          # ── Bar ──────────────────────────────────────────────
          bar.widgets = {
            left = [
              {
                id = "ControlCenter";
                useDistroLogo = true;
                icon = "noctalia";
              }
              {
                id = "Workspace";
                characterCount = 4;
                fontWeight = "bold";
                groupedBorderOpacity = 0;
                hideUnoccupied = true;
                iconScale = 1;
                labelMode = "none";
                showApplications = true;
                showBadge = true;
              }
            ];
            center = [
              {
                id = "ActiveWindow";
                showIcon = true;
                showText = true;
                hideMode = "hidden";
                scrollingMode = "hover";
                maxWidth = 300;
              }
            ];
            right = [
              {
                id = "Volume";
                displayMode = "onhover";
                middleClickCommand = "pwvucontrol";
              }
              {
                id = "Microphone";
                displayMode = "onhover";
                middleClickCommand = "pwvucontrol";
              }
              {
                id = "Network";
                displayMode = "onhover";
              }
              {
                id = "Clock";
                formatHorizontal = "HH:mm:ss";
                formatVertical = "HH mm";
              }
              {
                id = "Tray";
                drawerEnabled = false;
                hidePassive = false;
              }
            ];
          };

          # ── General ─────────────────────────────────────────
          general = {
            avatarImage = "/home/${config.home.username}/.face";
            radiusRatio = lib.mkDefault 0.2;
            compactLockScreen = lib.mkDefault true;
            passwordChars = lib.mkDefault true;
          };

          # ── UI ───────────────────────────────────────────────
          ui.translucentWidgets = lib.mkDefault true;

          # ── Wallpaper ────────────────────────────────────────
          wallpaper = {
            overviewEnabled = lib.mkDefault true;
            fillColor = lib.mkDefault "#001625";
            automationEnabled = lib.mkDefault true;
            randomIntervalSec = lib.mkDefault 1800;
          };

          # ── App Launcher ─────────────────────────────────────
          appLauncher = {
            terminalCommand = lib.mkDefault "kitty -e";
            iconMode = lib.mkDefault "native";
            overviewLayer = lib.mkDefault true;
            density = lib.mkDefault "compact";
          };

          # ── Control Center ───────────────────────────────────
          # brightness-card disabled
          controlCenter.cards = [
            {
              enabled = true;
              id = "profile-card";
            }
            {
              enabled = true;
              id = "shortcuts-card";
            }
            {
              enabled = true;
              id = "audio-card";
            }
            {
              enabled = false;
              id = "brightness-card";
            }
            {
              enabled = true;
              id = "weather-card";
            }
            {
              enabled = true;
              id = "media-sysmon-card";
            }
          ];

          # ── Dock ─────────────────────────────────────────────
          dock.enabled = lib.mkDefault false;

          # ── Notifications ────────────────────────────────────
          notifications = {
            enableMarkdown = lib.mkDefault true;
            density = lib.mkDefault "compact";
            backgroundOpacity = lib.mkDefault 0.8;
            sounds = {
              enabled = lib.mkDefault false;
              volume = lib.mkDefault 1;
              excludedApps = lib.mkDefault "discord,firefox,chrome,chromium,edge";
            };
            enableMediaToast = lib.mkDefault true;
          };

          # ── OSD ──────────────────────────────────────────────
          osd = {
            location = lib.mkDefault "top_right";
            enabledTypes = [
              0
              1
              2
            ];
          };

          # ── Audio ────────────────────────────────────────────
          audio.spectrumFrameRate = lib.mkDefault 30;

          # ── System Monitor ──────────────────────────────────
          systemMonitor.enableDgpuMonitoring = lib.mkDefault false;

          # ── Color Schemes ────────────────────────────────────
          colorSchemes.predefinedScheme = lib.mkDefault "Catppuccin";

          # ── Idle ─────────────────────────────────────────────
          idle = {
            enabled = lib.mkDefault true;
            screenOffTimeout = lib.mkDefault 300;
            lockTimeout = lib.mkDefault 360;
            suspendTimeout = lib.mkDefault 1800;
          };

          # ── Desktop Widgets ──────────────────────────────────
          desktopWidgets.enabled = lib.mkDefault false;
        };
      };
    };
}
