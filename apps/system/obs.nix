{ config, pkgs, ... }: {
  programs.obs-studio = {
    enable = true;
    # enableVirtualCamera = true;
    plugins = with pkgs.obs-studio-plugins;
      [
        # wlrobs
        # obs-backgroundremoval
        # obs-pipewire-audio-capture
      ];
  };

  #FIXME obs-studio enableVirtualCamera not working (v4l2loopback)
  boot.extraModulePackages = [
    # https://github.com/NixOS/nixpkgs/pull/411777
    (config.boot.kernelPackages.v4l2loopback.overrideAttrs (old: {
      version = "0.15.0";
      src = pkgs.fetchFromGitHub {
        owner = "umlaeute";
        repo = "v4l2loopback";
        rev = "v0.15.0";
        sha256 = "sha256-fa3f8GDoQTkPppAysrkA7kHuU5z2P2pqI8dKhuKYh04=";
      };
    }))
  ];
  boot.kernelModules = [ "v4l2loopback" ];
  boot.extraModprobeConfig = ''
    options v4l2loopback devices=1 video_nr=1 card_label="OBS Cam" exclusive_caps=1
  '';
}
