{ inputs, config, ... }:
let
  nixos = config.flake.modules.nixos;
  hm = config.flake.modules.homeManager;
  username = config.flake.username;
in
{
  flake.nixosConfigurations.frostbit = inputs.nixpkgs.lib.nixosSystem {
    modules = [
      # ── System-level modules ──────────────────────────────
      nixos.frostbitConfig
      nixos.niri
      nixos.noctalia
      nixos.sound
      nixos.audioInterface
      nixos.coding
      nixos.graphics
      nixos.gaming
      nixos.wslMount
      {
        wslMount.enable = true;
        wslMount.path = "/mnt/windows/Users/manu/AppData/Local/Packages/22955VineelSai.ArchWSL_qz230bc1wsk9j/LocalState/ext4.vhdx";
      }

      # ── Home Manager integration ─────────────────────────
      inputs.home-manager.nixosModules.home-manager
      {
        home-manager.useGlobalPkgs = true;
        home-manager.useUserPackages = true;
        home-manager.users.${username} = {
          home.username = username;
          home.homeDirectory = "/home/${username}";
          home.stateVersion = "25.11";

          imports = [
            hm.niri
            hm.noctalia
            hm.sound
            hm.discord
            hm.spotify
            hm.coding
            hm.bitwarden
            hm.terminal
            hm.frostbitKeybinds
          ];
          programs.bash.enable = true; # manage bashrc with hm.
          programs.direnv.config.global.hide_env_diff = true;

          programs.niri.settings = {
            prefer-no-csd = true; # Tell program avoid client-side decorations (like title bars) when possible
            input = {
              focus-follows-mouse = {
                enable = true;
                max-scroll-amount = "0%";
              };
              mouse = {
                accel-speed = 0;
                accel-profile = "adaptive";
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

          programs.noctalia-shell = {
            settings = {
              location.name = "Toulouse";
              wallpaper.directory = "/home/${username}/Pictures/Wallpapers";
              notifications.monitors = [ "DP-1" ];
              osd.monitors = [ "DP-1" ];
              general.animationSpeed = 1.3;
              general.scaleRatio = 0.9;
            };
            plugins = {
              version = "2";
              sources = [
                {
                  enabled = true;
                  name = "Official Noctalia Plugins";
                  url = "https://github.com/noctalia-dev/noctalia-plugins";
                }
              ];
              states = {
                # activate-linux.enabled = true; # didn't work but funny.
                model-usage.enabled = true;
                tailscale.enabled = true;
                slowbongo.enabled = true;
                screen-toolkit.enabled = true;
                port-monitor.enabled = true;
              };
            };
          };
        };
      }
    ];
  };
}
