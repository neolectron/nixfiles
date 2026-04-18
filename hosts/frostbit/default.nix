{ inputs, config, ... }:
let
  nixos = config.flake.modules.nixos;
  hm = config.flake.modules.homeManager;
  username = config.flake.username;
in
{
  config.flake.username = "neolectron";
  config.flake.nixosConfigurations.frostbit = inputs.nixpkgs.lib.nixosSystem {
    modules = [
      # ── System-level modules ──────────────────────────────
      nixos.frostbitHardwareConfiguration
      nixos.niri
      nixos.noctalia
      nixos.sound
      nixos.audioInterface
      nixos.coding
      nixos.terminal
      nixos.graphics
      nixos.gaming
      nixos.wslMount
      nixos.envisaged

      # ── System-level config ──────────────────────────────
      (
        { pkgs, ... }:
        {
          users.users.${config.flake.username} = {
            isNormalUser = true;
            description = "neolectron";
            extraGroups = [
              "networkmanager"
              "wheel"
            ];
          };

          # Networking
          networking.hostName = "frostbit";
          networking.networkmanager.enable = true;

          # Timezone & locale
          time.timeZone = "Europe/Paris";
          i18n.defaultLocale = "en_US.UTF-8";
          i18n.extraLocaleSettings = {
            LC_ADDRESS = "fr_FR.UTF-8";
            LC_IDENTIFICATION = "fr_FR.UTF-8";
            LC_MEASUREMENT = "fr_FR.UTF-8";
            LC_MONETARY = "fr_FR.UTF-8";
            LC_NAME = "fr_FR.UTF-8";
            LC_NUMERIC = "fr_FR.UTF-8";
            LC_PAPER = "fr_FR.UTF-8";
            LC_TELEPHONE = "fr_FR.UTF-8";
            LC_TIME = "fr_FR.UTF-8";
          };

          # Keyboard layout — qwerty-fr (QWERTY with French accents via AltGr)
          services.xserver.xkb = {
            layout = "us_qwerty-fr";
            variant = "qwerty-fr";
            extraLayouts.us_qwerty-fr = {
              description = "US QWERTY with French accents";
              languages = [
                "eng"
                "fra"
              ];
              symbolsFile = "${pkgs.qwerty-fr}/share/X11/xkb/symbols/us_qwerty-fr";
            };
          };

          # Boot
          boot.tmp.cleanOnBoot = true; # Clean /tmp on reboot (prevents stale lockfiles/sockets)
          boot.kernelPackages = pkgs.linuxPackages_latest;
          boot.supportedFilesystems = [ "ntfs" ];
          boot.loader.systemd-boot.enable = true;
          boot.loader.efi.canTouchEfiVariables = true;

          # Dual-boot: Windows on separate NVMe disk (Crucial P3 Plus)
          # Uses EDK2 UEFI Shell to chainload Windows Boot Manager from the NVMe ESP.
          # To find the efiDeviceHandle:
          #   1. nixos-rebuild boot, reboot, select "EDK2 UEFI Shell"
          #   2. Run: map -c
          #   3. Try: ls HDXcY:\EFI  (look for one containing Microsoft\)
          #   4. Verify: HDXcY:\EFI\Microsoft\Boot\Bootmgfw.efi
          #   5. Set the handle below and nixos-rebuild switch
          boot.loader.systemd-boot.edk2-uefi-shell.enable = true;
          boot.loader.systemd-boot.windows."windows" = {
            title = "Windows";
            efiDeviceHandle = "PLACEHOLDER"; # TODO: replace after UEFI shell discovery
          };
          wslMount.enable = true;
          wslMount.path = "/mnt/windows/Users/manu/AppData/Local/Packages/22955VineelSai.ArchWSL_qz230bc1wsk9j/LocalState/ext4.vhdx";

          # Nix config
          nixpkgs.config.allowUnfree = true;
          nix.settings.experimental-features = [
            "nix-command"
            "flakes"
          ];
          system.stateVersion = "25.11";
        }
      )

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
            hm.musicProd
            hm.wine
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
