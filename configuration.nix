{ config, lib, pkgs, inputs, ... }:

{
  imports = [
    ./hardware/hardware-configuration.nix # results of the hardware scan.
    ./system/audio.nix # audio configuration
    ./system/programs.nix # system programs configuration
    ./user/user.nix # user account, programs, and settings configuration
  ];

  # nix allow nix-command

  nixpkgs.config.allowUnfree = true;
  nix.settings.max-jobs = "auto";
  nix.settings.experimental-features = [ "nix-command" "flakes" ];
  nix.gc = {
    automatic = true;
    dates = "weekly";
    options = "--delete-older-than 7d";
  };

  security.polkit.enable = true;
  security.rtkit.enable = true;
  time.timeZone = "Europe/Paris";
  networking.hostName = "nixos";
  networking.networkmanager.enable = true;
  # Open ports in the firewall.
  # networking.firewall.allowedTCPPorts = [ ... ];
  # networking.firewall.allowedUDPPorts = [ ... ];
  # Or disable the firewall altogether.
  # networking.firewall.enable = false;

  services = { dbus.enable = true; };
  environment = { sessionVariables.NIXOS_OZONE_WL = "1"; };
  fonts = {
    enableDefaultPackages = true;
    packages = with pkgs; [ nerd-fonts.fira-code nerd-fonts.droid-sans-mono ];
  };

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

  # For more information, see `man configuration.nix` or https://nixos.org/manual/nixos/stable/options#opt-system.stateVersion .
  system.stateVersion = "25.05"; # First version of NixOS installed.
}

