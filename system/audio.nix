{ config, pkgs, lib, ... }:

{
  environment.systemPackages = with pkgs; [ helvum pavucontrol ];
  services.pipewire = {
    enable = true;
    audio.enable = true;
    pulse.enable = true;
    wireplumber.enable = true;
    alsa.enable = true;
    alsa.support32Bit = true;
    jack.enable = false;
  };
}
