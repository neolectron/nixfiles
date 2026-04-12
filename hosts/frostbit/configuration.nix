{ inputs, config, ... }:
{
  config.flake.username = "neolectron";
  config.flake.modules.nixos.frostbitConfig =
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

      # Passwordless sudo for wheel group
      # security.sudo = {
      #   enable = true;
      #   extraConfig = ''
      #     %wheel ALL=(ALL) NOPASSWD: ALL
      #   '';
      # };

      imports = [
        inputs.self.nixosModules.frostbitHardware
      ];
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

      # Nix config
      nixpkgs.config.allowUnfree = true;
      nix.settings.experimental-features = [
        "nix-command"
        "flakes"
      ];
      system.stateVersion = "25.11";
    };
}
