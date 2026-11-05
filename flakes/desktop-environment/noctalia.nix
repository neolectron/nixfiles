{ inputs, ... }:
{
  flake.modules.nixos.noctalia =
    { ... }:
    {
      services.power-profiles-daemon.enable = true;
      services.upower.enable = true;
    };

  flake.modules.homeManager.noctalia =
    {
      lib,
      pkgs,
      config,
      ...
    }:
    {
      imports = [ inputs.noctalia.homeModules.default ];
      home.packages = [ pkgs.fastfetch ];

      programs.noctalia = {
        enable = true;
        # The upstream module validates the generated TOML during the build.
        settings = {
          bar.main = {
            margin_ends = lib.mkDefault 0;
            margin_edge = lib.mkDefault 0;
            background_opacity = lib.mkDefault 0.93;
            padding = lib.mkDefault 2;
            capsule = lib.mkDefault true;
            radius = lib.mkDefault 0;
            start = [
              "control-center"
              "taskbar"
            ];
            center = [ "active_window" ];
            end = [
              "bongocat"
              "volume"
              "microphone"
              "network"
              "tailscale"
              "caffeine"
              "clock"
              "tray"
            ];
          };
          widget = {
            taskbar = {
              group_by_workspace = true;
              show_all_outputs = false;
              only_active_workspace = false;
              show_workspace_label = false;
              hide_empty_workspaces = true;
              workspace_group_capsule = true;
              workspace_group_content = "icons";
              group_single_icon_per_app = false;
              show_active_indicator = true;
            };
            active_window = {
              display = "icon_and_text";
              max_length = 300;
              title_scroll = "on_hover";
              show_empty_label = false;
            };
            bongocat = {
              type = "noctalia/bongocat:cat";
              audio_spectrum = true;
            };
            volume = {
              show_label = false;
              actions.middle = "exec pwvucontrol";
            };
            microphone = {
              type = "volume";
              device = "input";
              show_label = false;
              actions.middle = "exec pwvucontrol";
            };
            network.show_label = false;
            tailscale.type = "davemhammer/tailscale:status";
            clock = {
              format = "{:%H:%M:%S}";
              vertical_format = "{:%H %M}";
            };
            tray = {
              drawer = false;
              hide_passive = false;
            };
          };

          shell = {
            setup_wizard_enabled = lib.mkDefault false;
            avatar_path = "/home/${config.home.username}/.face";
            corner_radius_scale = lib.mkDefault 0.2;
            panel.transparency_mode = lib.mkDefault "soft";
          };
          wallpaper = {
            fill_color = lib.mkDefault "#001625";
            automation = {
              enabled = lib.mkDefault true;
              interval_seconds = lib.mkDefault 1800;
              order = lib.mkDefault "random";
            };
          };
          weather.enabled = lib.mkDefault true;
          backdrop.enabled = lib.mkDefault true;
          dock.enabled = lib.mkDefault false;
          notification = {
            background_opacity = lib.mkDefault 0.8;
            layer = lib.mkDefault "overlay";
          };
          audio = {
            enable_sounds = lib.mkDefault false;
            sound_volume = lib.mkDefault 1.0;
          };
          osd.position = lib.mkDefault "top_right";
          theme = {
            source = lib.mkDefault "builtin";
            builtin = lib.mkDefault "Catppuccin";
          };
          idle.behavior = {
            screen-off = {
              enabled = lib.mkDefault true;
              timeout = lib.mkDefault 300;
              action = lib.mkDefault "screen_off";
            };
            lock = {
              enabled = lib.mkDefault true;
              timeout = lib.mkDefault 360;
              action = lib.mkDefault "lock";
            };
            suspend = {
              enabled = lib.mkDefault true;
              timeout = lib.mkDefault 1800;
              action = lib.mkDefault "lock_and_suspend";
            };
          };
          desktop_widgets.enabled = lib.mkDefault false;
        };
      };
    };
}
