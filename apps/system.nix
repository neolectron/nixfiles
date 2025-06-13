# Main system configuration
{ config, lib, pkgs, inputs, systemSettings, userSettings, ... }: {
  nixpkgs.config.allowUnfree = true;
  nix.settings.max-jobs = "auto";
  nix.settings.experimental-features = [ "nix-command" "flakes" ];
  nix.gc = {
    automatic = true;
    dates = "weekly";
    options = "--delete-older-than 7d";
  };

  # Setting Main user account
  users.users.${userSettings.username} = {
    isNormalUser = true;
    description = userSettings.name;
    extraGroups = [ "networkmanager" "wheel" ];
    # packages = with pkgs; [];
  };

  # Fonts
  fonts = {
    enableDefaultPackages = true;
    packages = with pkgs; [ nerd-fonts.fira-code nerd-fonts.droid-sans-mono ];
  };

  # System settings
  time.timeZone = systemSettings.timezone;
  networking.hostName = systemSettings.hostname;
  networking.networkmanager.enable = true;

  # Services
  services = { dbus.enable = true; };

  # Environment
  environment = { 
    sessionVariables.NIXOS_OZONE_WL = "1";
    systemPackages = with pkgs; [
      vim
      wget
      git
      # home-manager
    ];
  };

  # Security
  security.polkit.enable = true;
  security.rtkit.enable = true;
  security.sudo.enable = true;

  # Boot configuration
  boot = {
    kernelPackages = pkgs.linuxPackages_latest;
    loader = {
      # Use the systemd-boot EFI boot loader.
      systemd-boot = {
        enable = true;
        configurationLimit = 3;
      };
      efi.canTouchEfiVariables = true;
      efi.efiSysMountPoint = "/boot";
    };
  };

  # System state version
  system.stateVersion = "25.05";
}
