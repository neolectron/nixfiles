{ inputs, config, ... }:
let
  username = config.flake.username;
in
{
  flake.modules.nixos.mainConfiguration =
    { pkgs, ... }:
    {
      imports = [
        inputs.self.nixosModules.mainHardware
      ];

      # Bootloader
      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;

      # Use latest kernel
      boot.kernelPackages = pkgs.linuxPackages_latest;

      # Networking
      networking.hostName = "main";
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

      # Keyboard layout
      services.xserver.xkb = {
        layout = "us";
        variant = "";
      };

      # User account
      users.users.${username} = {
        isNormalUser = true;
        description = username;
        extraGroups = [
          "networkmanager"
          "wheel"
        ];
      };

      # Passwordless sudo for wheel group
      # security.sudo = {
      #   enable = true;
      #   extraConfig = ''
      #     %wheel ALL=(ALL) NOPASSWD: ALL
      #   '';
      # };

      # Allow unfree packages
      nixpkgs.config.allowUnfree = true;

      # Enable flakes
      nix.settings.experimental-features = [
        "nix-command"
        "flakes"
      ];

      system.stateVersion = "25.11";
    };
}
