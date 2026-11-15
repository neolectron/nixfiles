{ config, ... }:
let
  username = config.nixfiles.username;
in
{
  flake.modules.homeManager.frostbit-desktop =
    { ... }:
    {
      programs.niri.settings = {
        prefer-no-csd = true; # Tell program avoid client-side decorations (like title bars) when possible
        input = {
          focus-follows-mouse = {
            enable = true;
            max-scroll-amount = "0%";
          };
          mouse = {
            accel-profile = "flat";
          };
          keyboard.xkb = {
            layout = "us_qwerty-fr";
            variant = "qwerty-fr";
          };
        };
        outputs = {
          "DP-1".position = {
            x = 0;
            y = 0;
          };
          "HDMI-A-1".position = {
            x = 1920;
            y = 0;
          };
        };
        # Steam Remote Play streams the primary monitor (DP-1); keep Big Picture on it.
        window-rules = [
          {
            matches = [
              {
                app-id = "^steam$";
                title = "^Steam Big Picture Mode$";
              }
            ];
            open-on-output = "DP-1";
          }
        ];
        layout = {
          # White focus ring on active window only (follows corner radius with prefer-no-csd)
          border.enable = false;
          focus-ring = {
            enable = true;
            width = 1;
            active.color = "#ffffff";
            inactive.color = "#00000000";
          };
          # Subtle shadow on active window only
          shadow = {
            enable = true;
            softness = 20.0;
            spread = 2.0;
            offset = {
              x = 0.0;
              y = 2.0;
            };
            color = "#00000040";
            inactive-color = "#00000000";
          };
        };

      };

      programs.noctalia.settings = {
        idle.behavior.suspend.enabled = false;
        location.address = "Toulouse";
        wallpaper.directory = "/home/${username}/Pictures/Wallpapers";
        notification.monitors = [ "DP-1" ];
        osd.monitors = [ "DP-1" ];
        shell.animation.speed = 1.3;
        accessibility.ui_scale = 0.9;
        audio.enable_overdrive = true;
        plugins.enabled = [
          "davemhammer/tailscale"
          "alexander/screen-toolkit"
        ];
      };
    };
}
