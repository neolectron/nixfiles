# Edit this configuration file to define what should be installed on
# your system.  Help is available in the configuration.nix(5) man page
# and in the NixOS manual (accessible by running ‘nixos-help’).

{ systemSettings, userSettings, ... }: {
  imports = [
    # hardware
    ../../hardware/hardware-configuration.nix
    ../../hardware/umc1820.nix
    ../../hardware/keyboard.nix
    # system apps
    ../../apps/system.nix
    ../../apps/system/pipewire.nix
    ../../apps/system/gamemode.nix
    ../../apps/system/steam.nix
    # desktop environment
    ../../apps/desktop-environment/hyprland.nix
  ];
}
