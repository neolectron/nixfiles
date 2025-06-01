{ config, pkgs, lib, ... }:

{
  environment.systemPackages = with pkgs; [ helvum pavucontrol ];
  services.pipewire = {
    enable = true;
    pulse.enable = true;
  };
}
