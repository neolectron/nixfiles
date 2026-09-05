{ inputs, config, ... }:
let
  username = "lab";
in
{
  config.flake.nixosConfigurations.frostbit-lab = inputs.nixpkgs.lib.nixosSystem {
    specialArgs = { inherit inputs; };
    modules = [
      inputs.niri.nixosModules.niri
      inputs.home-manager.nixosModules.home-manager
      (
        { pkgs, ... }:
        {
          nixpkgs.hostPlatform = "x86_64-linux";
          networking.hostName = "frostbit-lab";
          time.timeZone = "Europe/Paris";
          i18n.defaultLocale = "en_US.UTF-8";

          nixpkgs.config.allowUnfree = true;
          nix.settings.experimental-features = [
            "nix-command"
            "flakes"
          ];

          # Keep the base configuration valid before build-vm applies its
          # virtualisation-specific filesystem and bootloader overrides.
          fileSystems."/" = {
            device = "/dev/disk/by-label/nixos";
            fsType = "ext4";
          };
          boot.loader.grub.device = "/dev/disk/by-id/virtio-root";

          # This machine is intended to be driven entirely by the lab MCP server.
          users.users.${username} = {
            isNormalUser = true;
            extraGroups = [ "wheel" ];
            initialPassword = "lab";
          };
          security.sudo.wheelNeedsPassword = false;

          programs.niri.enable = true;
          programs.niri.package = pkgs.niri;
          services.greetd = {
            enable = true;
            settings.default_session = {
              command = "${pkgs.cage}/bin/cage -s -- ${pkgs.foot}/bin/foot";
              user = username;
            };
          };

          services.pipewire = {
            enable = true;
            audio.enable = true;
            pulse.enable = true;
            wireplumber.enable = true;
          };

          environment.systemPackages = [
            pkgs.foot
            pkgs.wineWow64Packages.waylandFull
            pkgs.winetricks
            pkgs.corefonts
          ];

          # build-vm adds this module only for the guest.  The host-side runner
          # supplies CODEX_LAB_REPO and keeps the writable qcow2 image in its
          # runtime directory, so changes persist across agent turns.
          virtualisation.vmVariant = {
            virtualisation = {
              memorySize = 8192;
              cores = 4;
              graphics = true;
              writableStore = true;
              qemu.options = [
                "-qmp unix:/tmp/codex-lab-vm/qmp.sock,server=on,wait=off"
                "-display none"
              ];
            };

            virtualisation.sharedDirectories.repo = {
              source = "$CODEX_LAB_REPO";
              target = "/workspace/nixfiles";
              securityModel = "none";
            };
          };

          home-manager = {
            useGlobalPkgs = true;
            useUserPackages = true;
            users.${username} = {
              home.username = username;
              home.homeDirectory = "/home/${username}";
              home.stateVersion = "25.11";
              programs.niri.settings = {
                spawn-at-startup = [
                  { command = [ "foot" ]; }
                ];
                binds."Mod+Return".action.spawn = [ "foot" ];
                input.keyboard.xkb.layout = "us";
              };
            };
          };

          system.stateVersion = "25.11";
        }
      )
    ];
  };
}
