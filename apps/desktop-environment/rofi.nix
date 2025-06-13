{ config, pkgs, lib, ... }:

{
  home.packages = [ pkgs.rofi ];
  # rofi-emoji # TODO: automatically search for emojis when ":" is typed
}
