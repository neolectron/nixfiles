{ inputs, config, ... }:
let
  nixos = config.flake.modules.nixos;
  hm = config.flake.modules.homeManager;
  username = config.nixfiles.username;
in
{

  config.nixfiles.username = "neolectron";
  config.nixfiles.opencode.hostname = "0.0.0.0"; # Enable LAN access for frostbit
  config.nixfiles.opencode.database = "opencode-v2-frostbit.db";
  config.flake.nixosConfigurations.frostbit = inputs.nixpkgs.lib.nixosSystem {
    modules = [
      # ── System-level modules ──────────────────────────────
      inputs.nix-index-database.nixosModules.default
      nixos.frostbit-hardware
      nixos.frostbit-peripherals
      nixos.frostbit-rebuild-authorization
      nixos.frostbit-streamdeck
      nixos.codex-desktop
      nixos.niri
      nixos.noctalia
      nixos.plasma-system-monitor
      nixos.sound
      nixos.frostbit-audio-interface
      nixos.coding
      nixos.terminal
      nixos.graphics
      nixos.steam
      nixos.sunshine
      nixos.wsl-mount
      nixos.gparted
      nixos.media-stack
      nixos.obs
      nixos.spotifast
      nixos.wifi-audio-streaming
      nixos.android-phone

      # ── System-level config ──────────────────────────────
      (
        { pkgs, ... }@os:
        {
          users.users.${config.nixfiles.username} = {
            isNormalUser = true;
            description = "neolectron";
            extraGroups = [
              "networkmanager"
              "wheel"
              "input"
            ];
          };

          system.stateVersion = "25.11";
        }
      )
      nixos.frostbit-networking
      nixos.locale
      nixos.frostbit-boot
      nixos.nix

      # ── Home Manager integration ─────────────────────────
      inputs.home-manager.nixosModules.home-manager
      {
        home-manager.useGlobalPkgs = true;
        home-manager.useUserPackages = true;
        home-manager.backupFileExtension = "backup";
        home-manager.sharedModules = [
          inputs.nix-index-database.homeModules.nix-index
        ];
        home-manager.users.${username} = {
          home.username = username;
          home.homeDirectory = "/home/${username}";
          home.stateVersion = "25.11";
          # Root's nix.gc does not expire per-user Home Manager generations
          services.home-manager.autoExpire = {
            enable = true;
            frequency = "weekly";
            timestamp = "-14 days";
          };

          imports = [
            hm.frostbit-desktop
            # Desktop environment & system integration
            hm.niri
            hm.sound
            hm.noctalia
            hm.frostbit-keybinds
            hm.dolphin
            # Features
            hm.terminal
            hm.coding
            hm.zed
            hm.music-prod
            hm.nixvim
            # Applications
            hm.obs
            hm.utility-apps
            hm.chrome
            hm.discord
            hm.gologin
            hm.spotify
            hm.bitwarden
            hm.curseforge
            hm.wine
            hm.vicinae
            hm.chataigne
            hm.game-launchers
            hm.codex-desktop
            hm.keep-awake
            hm.streamdeck
            hm.agent-skills
            hm.humanlayer
            hm.wifi-audio-streaming
            hm.android-phone
          ];
          programs.bash.enable = true; # manage bashrc with hm.
          programs.direnv.config.global.hide_env_diff = true;
          programs.nix-index-database.comma.enable = true;
        };
      }
    ];
  };
}
