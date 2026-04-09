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

      nixpkgs.overlays = [ inputs.niri.overlays.niri ];
      programs.niri.enable = true;
      programs.niri.package = pkgs.niri-unstable;

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
      # Cursor theme (must match niri cursor settings so compositor and apps agree)
      home.pointerCursor = {
        name = lib.mkDefault "Adwaita";
        package = lib.mkDefault pkgs.adwaita-icon-theme;
        size = lib.mkDefault 24;
        gtk.enable = true;
      };

      # Let HM manage GTK settings so cursor theme propagates to GTK apps
      gtk.enable = true;

      programs.niri.settings = {
        # Window rules
        window-rules = [
          # Slight corner radius on all windows
          {
            geometry-corner-radius =
              let
                r = 2.0;
              in
              {
                top-left = r;
                top-right = r;
                bottom-left = r;
                bottom-right = r;
              };
            clip-to-geometry = true;
          }

          # Chrome / Chromium Picture-in-Picture
          {
            matches = [
              { title = "^Picture in picture$"; }
            ];
            open-floating = true;
          }

          # pwvucontrol — floating top-right
          {
            matches = [
              { app-id = "^com\\.saivert\\.pwvucontrol$"; }
            ];
            open-floating = true;
            default-floating-position = {
              x = 0;
              y = 0;
              relative-to = "top-right";
            };
          }
        ];
        # Cursor theme (must match home.pointerCursor so niri and spawned apps agree)
        cursor = {
          theme = lib.mkDefault "Adwaita";
          size = lib.mkDefault 24;
        };

        # XWayland support via xwayland-satellite (X11 compat for apps like Discord)
        xwayland-satellite.path = lib.getExe pkgs.xwayland-satellite;

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
            layout = lib.mkDefault "us";
          };
          mouse = {
            accel-speed = lib.mkDefault 1;
            accel-profile = lib.mkDefault "flat";
          };
          focus-follows-mouse.enable = lib.mkDefault false;
          warp-mouse-to-focus.enable = lib.mkDefault false;
        };

        # Disable hot corners (overview on top-left hover)
        gestures.hot-corners.enable = lib.mkDefault false;

        # Layout
        layout = {
          gaps = lib.mkDefault 8;
          center-focused-column = lib.mkDefault "never";

          border = {
            enable = lib.mkDefault true;
            width = lib.mkDefault 2;
            active.color = lib.mkDefault "#89b4fa";
            inactive.color = lib.mkDefault "#313244";
          };

          focus-ring.enable = lib.mkDefault false;

          preset-column-widths = [
            { proportion = 1.0 / 3.0; }
            { proportion = 1.0 / 2.0; }
            { proportion = 2.0 / 3.0; }
          ];

          default-column-width = {
            proportion = lib.mkDefault (1.0 / 2.0);
          };
        };

        # Keybindings
        binds = {
          # Launch apps
          "Mod+Return".action.spawn = "kitty";
          "Mod+Space".action.spawn = [
            "noctalia-shell"
            "ipc"
            "call"
            "launcher"
            "toggle"
          ];

          # Window management
          "Mod+Q".action.close-window = [ ];
          "Mod+F".action.maximize-column = [ ];
          "Mod+Shift+F".action.fullscreen-window = [ ];
          "Mod+R".action.switch-preset-column-width = [ ];
          "Mod+Tab".action.toggle-overview = [ ];

          "Print".action.screenshot = [ ];
          "Mod+Print".action.screenshot-screen = [ ];
          "Mod+Ctrl+Q".action.quit = {
            # skip-confirmation = true;
          };

          # Floating (Alt key)
          "Mod+Alt+F".action.toggle-window-floating = [ ];
          "Mod+Alt+Shift+F".action.switch-focus-between-floating-and-tiling = [ ];

          # Focus windows (Arrow keys)
          "Mod+Left".action.focus-column-left = [ ];
          "Mod+Right".action.focus-column-right = [ ];
          "Mod+Up".action.focus-window-or-workspace-up = [ ];
          "Mod+Down".action.focus-window-or-workspace-down = [ ];

          # Focus windows (HJKL)
          "Mod+H".action.focus-column-left = [ ];
          "Mod+L".action.focus-column-right = [ ];
          "Mod+K".action.focus-window-or-workspace-up = [ ];
          "Mod+J".action.focus-window-or-workspace-down = [ ];

          # Focus workspaces/monitors (Ctrl+Arrow keys)
          "Mod+Ctrl+Left".action.focus-monitor-left = [ ];
          "Mod+Ctrl+Right".action.focus-monitor-right = [ ];
          "Mod+Ctrl+Up".action.focus-workspace-up = [ ];
          "Mod+Ctrl+Down".action.focus-workspace-down = [ ];

          # Focus workspaces/monitors (Ctrl+HJKL)
          "Mod+Ctrl+H".action.focus-monitor-left = [ ];
          "Mod+Ctrl+L".action.focus-monitor-right = [ ];
          "Mod+Ctrl+K".action.focus-workspace-up = [ ];
          "Mod+Ctrl+J".action.focus-workspace-down = [ ];

          # Move windows (Shift+Arrow keys)
          "Mod+Shift+Left".action.move-column-left = [ ];
          "Mod+Shift+Right".action.move-column-right = [ ];
          "Mod+Shift+Up".action.move-window-up = [ ];
          "Mod+Shift+Down".action.move-window-down = [ ];

          # Move windows (Shift+HJKL)
          "Mod+Shift+H".action.move-column-left = [ ];
          "Mod+Shift+L".action.move-column-right = [ ];
          "Mod+Shift+K".action.move-window-up = [ ];
          "Mod+Shift+J".action.move-window-down = [ ];

          # Move window to workspace (Ctrl+Shift+Arrow keys)
          "Mod+Ctrl+Shift+Left".action.move-window-to-monitor-left = [ ];
          "Mod+Ctrl+Shift+Right".action.move-window-to-monitor-right = [ ];
          "Mod+Ctrl+Shift+Up".action.move-window-to-workspace-up = [ ];
          "Mod+Ctrl+Shift+Down".action.move-window-to-workspace-down = [ ];

          # Move window to workspace (Ctrl+Shift+HJKL)
          "Mod+Ctrl+Shift+H".action.move-window-to-monitor-left = [ ];
          "Mod+Ctrl+Shift+L".action.move-window-to-monitor-right = [ ];
          "Mod+Ctrl+Shift+K".action.move-window-to-workspace-up = [ ];
          "Mod+Ctrl+Shift+J".action.move-window-to-workspace-down = [ ];

          # Workspaces (number keys)
          "Mod+1".action.focus-workspace = 1;
          "Mod+2".action.focus-workspace = 2;
          "Mod+3".action.focus-workspace = 3;
          "Mod+4".action.focus-workspace = 4;
          "Mod+5".action.focus-workspace = 5;
          # Workspaces Move (Shift+number keys)
          "Mod+Shift+1".action.move-window-to-workspace = 1;
          "Mod+Shift+2".action.move-window-to-workspace = 2;
          "Mod+Shift+3".action.move-window-to-workspace = 3;
          "Mod+Shift+4".action.move-window-to-workspace = 4;
          "Mod+Shift+5".action.move-window-to-workspace = 5;

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

        };
      };
    };
}
