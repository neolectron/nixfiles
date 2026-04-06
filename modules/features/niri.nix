{ inputs, config, ... }:
let
  username = config.flake.username;
in
{
  # NixOS side: enable niri compositor + greetd auto-login
  flake.modules.nixos.niri =
    { pkgs, ... }:
    {
      imports = [
        inputs.niri.nixosModules.niri
      ];

      # Apply niri overlay so pkgs.niri-stable is available
      nixpkgs.overlays = [ inputs.niri.overlays.niri ];

      # Enable niri (auto-configures XDG portals, polkit, gnome-keyring, etc.)
      programs.niri.enable = true;

      # Add GTK portal backend for file chooser dialogs (Save As, Open File, etc.)
      # The GNOME backend installed by niri delegates FileChooser to Nautilus,
      # which isn't installed. The GTK backend provides a standalone file picker.
      xdg.portal.extraPortals = [ pkgs.xdg-desktop-portal-gtk ];

      # Override niri's default portal preferences to force GTK for FileChooser.
      # The GNOME backend claims FileChooser but delegates to Nautilus at runtime;
      # when Nautilus is missing, the call fails without falling back to GTK.
      # This writes to /etc/xdg/xdg-desktop-portal/niri-portals.conf, which takes
      # priority over the niri-portals.conf shipped by the niri package.
      xdg.portal.config.niri = {
        default = [
          "gnome"
          "gtk"
        ];
        "org.freedesktop.impl.portal.FileChooser" = [ "gtk" ];
        "org.freedesktop.impl.portal.Access" = [ "gtk" ];
        "org.freedesktop.impl.portal.Notification" = [ "gtk" ];
        "org.freedesktop.impl.portal.Secret" = [ "gnome-keyring" ];
      };

      # Electron apps on Wayland
      environment.sessionVariables.NIXOS_OZONE_WL = "1";

      # greetd: auto-login into niri
      services.greetd = {
        enable = true;
        settings = {
          default_session = {
            command = "niri-session";
            user = username;
          };
        };
      };

      # Restart greetd after logout so it re-triggers auto-login into niri
      services.greetd.restart = true;
    };

  # Home Manager side: niri keybindings, layout, and startup
  flake.modules.homeManager.niri =
    { pkgs, lib, ... }:
    {
      programs.niri.settings = {
        # Window rules
        window-rules = [
          # Chrome / Chromium Picture-in-Picture
          {
            matches = [
              { title = "^Picture in Picture$"; }
            ];
            open-floating = true;
          }

          # Firefox Picture-in-Picture
          {
            matches = [
              {
                app-id = "firefox$";
                title = "^Picture-in-Picture$";
              }
            ];
            open-floating = true;
          }
        ];
        # Cursor theme (must match home.pointerCursor so niri and spawned apps agree)
        cursor = {
          theme = "Adwaita";
          size = 24;
        };

        # XWayland support via xwayland-satellite (X11 compat for apps like Discord)
        xwayland-satellite.path = lib.getExe pkgs.xwayland-satellite;

        # Output positioning (swap left/right)
        outputs = {
          "HDMI-A-1" = {
            position = {
              x = 1920;
              y = 0;
            };
          };
          "DP-1" = {
            position = {
              x = 0;
              y = 0;
            };
          };
        };

        # Spawn noctalia-shell and other startup apps
        spawn-at-startup = [
          { command = [ "noctalia-shell" ]; }
        ];

        # Environment
        environment = {
          "NIXOS_OZONE_WL" = "1";
        };

        # Input
        input = {
          keyboard.xkb = {
            layout = "us";
          };
          focus-follows-mouse.enable = false;
          warp-mouse-to-focus.enable = false;
        };

        # Layout
        layout = {
          gaps = 8;
          center-focused-column = "on-overflow";

          border = {
            enable = true;
            width = 2;
            active.color = "#89b4fa";
            inactive.color = "#313244";
          };

          focus-ring.enable = false;

          preset-column-widths = [
            { proportion = 1.0 / 3.0; }
            { proportion = 1.0 / 2.0; }
            { proportion = 2.0 / 3.0; }
          ];

          default-column-width = {
            proportion = 1.0 / 2.0;
          };
        };

        # Keybindings
        binds = {
          # Launch apps
          "Mod+T".action.spawn = "kitty";
          "Mod+Space".action.spawn = [
            "noctalia-shell"
            "ipc"
            "call"
            "launcher"
            "toggle"
          ];

          # Window management
          "Mod+Q".action.close-window = [ ];

          # Focus
          "Mod+Left".action.focus-column-left = [ ];
          "Mod+Right".action.focus-column-right = [ ];
          "Mod+Up".action.focus-window-up = [ ];
          "Mod+Down".action.focus-window-down = [ ];

          # Move windows
          "Mod+Shift+Left".action.move-column-left = [ ];
          "Mod+Shift+Right".action.move-column-right = [ ];
          "Mod+Shift+Up".action.move-window-up = [ ];
          "Mod+Shift+Down".action.move-window-down = [ ];

          # Workspaces
          "Mod+1".action.focus-workspace = 1;
          "Mod+2".action.focus-workspace = 2;
          "Mod+3".action.focus-workspace = 3;
          "Mod+4".action.focus-workspace = 4;
          "Mod+5".action.focus-workspace = 5;

          "Mod+Shift+1".action.move-window-to-workspace = 1;
          "Mod+Shift+2".action.move-window-to-workspace = 2;
          "Mod+Shift+3".action.move-window-to-workspace = 3;
          "Mod+Shift+4".action.move-window-to-workspace = 4;
          "Mod+Shift+5".action.move-window-to-workspace = 5;

          # Columns + fullscreen (F)
          "Mod+R".action.switch-preset-column-width = [ ];
          "Mod+F".action.maximize-column = [ ];
          "Mod+Shift+F".action.fullscreen-window = [ ];

          # Floating (Ctrl)
          "Mod+Ctrl+F".action.toggle-window-floating = [ ];
          "Mod+Ctrl+Shift+F".action.switch-focus-between-floating-and-tiling = [ ];

          # Volume keys
          "XF86AudioRaiseVolume".action.spawn = [
            "wpctl"
            "set-volume"
            "@DEFAULT_AUDIO_SINK@"
            "0.05+"
          ];
          "XF86AudioLowerVolume".action.spawn = [
            "wpctl"
            "set-volume"
            "@DEFAULT_AUDIO_SINK@"
            "0.05-"
          ];
          "XF86AudioMute".action.spawn = [
            "wpctl"
            "set-mute"
            "@DEFAULT_AUDIO_SINK@"
            "toggle"
          ];

          # Screenshot
          "Print".action.screenshot = [ ];
          "Mod+Print".action.screenshot-screen = [ ];

          # Quit niri
          "Mod+Ctrl+Q".action.quit = {
            # skip-confirmation = true;
          };
        };
      };
    };
}
