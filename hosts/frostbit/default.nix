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
          imports = [
            hm.niri
            hm.noctalia
            hm.sound
            hm.discord
            hm.spotify
            hm.coding
            hm.terminal
            hm.cursor
          ];

          home.username = username;
          home.homeDirectory = "/home/${username}";
          home.stateVersion = "25.11";
        };
      }
    ];
  };
}
