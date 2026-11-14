{ ... }:
{
  # NixOS side: PipeWire audio
  flake.modules.nixos.sound =
    { ... }:
    {
      services.pulseaudio.enable = false;
      security.rtkit.enable = true;

      services.pipewire = {
        enable = true;
        audio.enable = true;
        alsa.enable = true;
        alsa.support32Bit = true;
        pulse.enable = true;
        wireplumber.enable = true;
        # No jack.enable: it exports the PipeWire JACK library through a global
        # LD_LIBRARY_PATH. JACK clients get it themselves (pipewire.jack).
      };
    };

  # Home Manager side: audio control tools
  flake.modules.homeManager.sound =
    { pkgs, ... }:
    {
      home.packages = [
        pkgs.pwvucontrol
        pkgs.crosspipe
      ];
    };
}
