{ inputs, config, ... }:
let
  inherit (inputs.nixpkgs) lib;
  nixos = config.flake.modules.nixos;
  hm = config.flake.modules.homeManager;
  username = config.nixfiles.username;

  # Each name enables the feature's NixOS half and/or its Home Manager half,
  # whichever its module file defines.
  features = [
    # This machine
    "frostbit-desktop"
    "frostbit-hardware"
    "frostbit-peripherals"
    "frostbit-boot"
    "frostbit-networking"
    "frostbit-audio-interface"
    "frostbit-keybinds"
    "frostbit-rebuild-authorization"
    "frostbit-streamdeck"

    # System
    "nix"
    "locale"
    "graphics"
    "sound"
    "wsl-mount"

    # Desktop
    "niri"
    "noctalia"
    "vicinae"
    "dolphin"
    "plasma-system-monitor"

    # Apps
    "utility-apps"
    "chrome"
    "discord"
    "gologin"
    "bitwarden"
    "gparted"
    "streamdeck"
    "wifi-audio-streaming"
    "android-phone"

    # Media
    "obs"
    "spotify"
    "spotifast"
    "chataigne"
    "music-prod"
    "media-stack"

    # Gaming
    "steam"
    "game-launchers"
    "curseforge"
    "wine"
    "sunshine"

    # Development
    "terminal"
    "coding"
    "zed"
    "nixvim"
    "codex-desktop"
    "keep-awake"
    "agent-skills"
    "humanlayer"
  ];

  halves =
    namespace: lib.concatMap (name: lib.optional (namespace ? ${name}) namespace.${name}) features;
  unknown = lib.filter (name: !(nixos ? ${name}) && !(hm ? ${name})) features;
in
{
  config.nixfiles.username = "neolectron";
  config.nixfiles.opencode.hostname = "0.0.0.0"; # Enable LAN access for frostbit
  config.nixfiles.opencode.database = "opencode-v2-frostbit.db";
  config.flake.nixosConfigurations.frostbit =
    assert lib.assertMsg (unknown == [ ]) "frostbit: unknown features: ${toString unknown}";
    inputs.nixpkgs.lib.nixosSystem {
      modules = [
        inputs.nix-index-database.nixosModules.default
        inputs.home-manager.nixosModules.home-manager
        {
          users.users.${username} = {
            isNormalUser = true;
            description = "neolectron";
            extraGroups = [
              "networkmanager"
              "wheel"
              "input"
            ];
          };
          system.stateVersion = "25.11";

          home-manager.useGlobalPkgs = true;
          home-manager.useUserPackages = true;
          home-manager.backupFileExtension = "backup";
          home-manager.sharedModules = [
            inputs.nix-index-database.homeModules.nix-index
          ];
          home-manager.users.${username} = {
            imports = halves hm;
            home.username = username;
            home.homeDirectory = "/home/${username}";
            home.stateVersion = "25.11";
            # Root's nix.gc does not expire per-user Home Manager generations
            services.home-manager.autoExpire = {
              enable = true;
              frequency = "weekly";
              timestamp = "-14 days";
            };
            programs.bash.enable = true; # manage bashrc with hm.
            programs.direnv.config.global.hide_env_diff = true;
            programs.nix-index-database.comma.enable = true;
          };
        }
      ]
      ++ halves nixos;
    };
}
