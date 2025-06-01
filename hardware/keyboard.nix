{ config, lib, pkgs, ... }:

{
  environment.systemPackages = [ pkgs.qwerty-fr ];
  # wayland.windowManager.hyprland.settings =
  #   lib.mkIf config.wayland.windowManager.hyprland.enable {
  #     input = {
  #       kb_layout = "fr";
  #       kb_variant = "us";
  #     };
  #   };
}

