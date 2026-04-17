{ ... }:
{
  # NixOS side: Behringer UMC1820 virtual microphones via PipeWire loopback
  #
  # The UMC1820 exposes a single 18-channel ALSA device. Apps like Discord
  # only understand simple mono/stereo sources, so we use loopback modules
  # to extract individual AUX channels into standalone Audio/Source nodes.
  #
  # ALSA NODE NAME includes the device serial number.
  # Find yours with: pw-cli list-objects | grep -A2 BEHRINGER
  # Current: alsa_input.usb-BEHRINGER_UMC1820_BAB9273B-00.multichannel-input
  #
  # DEBUGGING:
  #   pw-cli list-objects | grep -i "loopback\|Audio/Source\|UMC"
  #   journalctl --user -u pipewire -n 50
  #   journalctl --user -u wireplumber -n 50
  #   crosspipe  (visual audio routing patchbay)
  #   pavucontrol  (volume levels & device selection)
  #
  # AUX2: XLR microphone input + virtual speaker output
  # To add more channels, duplicate the loopback block and change AUX2.
  flake.modules.nixos.audioInterface =
    { pkgs, ... }:
    {
      services.pipewire.configPackages = [
        (pkgs.writeTextDir "share/pipewire/pipewire.conf.d/umc1820-loopback.conf" ''
          context.modules = [
            {
              name = libpipewire-module-loopback
              args = {
                node.description = "XLR microphone"
                capture.props = {
                  node.name         = capture.UMC1820_AUX2
                  audio.position    = [ AUX2 ]
                  stream.dont-remix = true
                  target.object     = "alsa_input.usb-BEHRINGER_UMC1820_BAB9273B-00.multichannel-input"
                  node.passive      = true
                }
                playback.props = {
                  node.name         = UMC1820_Mic_AUX2
                  media.class       = "Audio/Source"
                  audio.position    = [ MONO ]
                }
              }
            }
            {
              name = libpipewire-module-loopback
              args = {
                node.description = "speaker"
                capture.props = {
                  node.name      = speaker_input
                  media.class    = "Audio/Sink"
                  audio.position = [ MONO ]
                }
                playback.props = {
                  node.name         = UMC1820_Speaker_AUX2
                  audio.position    = [ AUX2 ]
                  stream.dont-remix = true
                  target.object     = "alsa_output.usb-BEHRINGER_UMC1820_BAB9273B-00.multichannel-output"
                  node.passive      = true
                }
              }
            }
            {
              name = libpipewire-module-loopback
              args = {
                node.description = "headphones"
                capture.props = {
                  node.name      = headphones_input
                  media.class    = "Audio/Sink"
                  audio.position = [ FL FR ]
                }
                playback.props = {
                  node.name         = UMC1820_Headphones
                  audio.position    = [ AUX0 AUX1 ]
                  stream.dont-remix = true
                  target.object     = "alsa_output.usb-BEHRINGER_UMC1820_BAB9273B-00.multichannel-output"
                  node.passive      = true
                }
              }
            }
          ]
        '')
      ];
    };
}
