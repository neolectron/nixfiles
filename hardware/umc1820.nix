# The goal of this module is to create virtual microphones for each AUX input
# of the Behringer UMC1820 sound card.

{ config, pkgs, lib, ... }:
let
  soundcardNode =
    "alsa_input.usb-BEHRINGER_UMC1820_BAB9273B-00.multichannel-input";

  portNames = builtins.genList (i: "capture_AUX${toString i}") 12;

  makeLoopback = i: portName: {
    name = "libpipewire-module-loopback";
    args = {
      node.name = "UMC1820_${portName}";
      media.name = "UMC1820 ${portName}";
      capture.props = {
        node.name = "capture_${portName}";
        node.target = {
          object = soundcardNode;
          port = portName;
        };
      };
      playback.props = {
        media.class = "Stream/Source/Virtual";
        node.description = "Virtual Mic for ${portName}";
      };
    };
  };

  loopbackModules = builtins.listToAttrs (lib.imap0 (i: portName: {
    name = "loopback-${toString i}";
    value = makeLoopback i portName;
  }) portNames);
in {
  services.pipewire.extraConfig.pipewire."context.modules" = loopbackModules;
}
