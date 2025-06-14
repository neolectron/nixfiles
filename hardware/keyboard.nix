{ config, lib, pkgs, ... }:

{
  environment.systemPackages = [ pkgs.qwerty-fr ];
  
  # Register the qwerty-fr XKB layout, works only with xserver, we should find a way to use it with Wayland/Hyprland.
  services.xserver.xkb = {
    extraLayouts.qwerty-fr = {
      description = "French symbols on US QWERTY layout";
      languages = [ "fr" ];
      symbolsFile = "${pkgs.qwerty-fr}/share/X11/xkb/symbols/us_qwerty-fr";
    };
  };
}

