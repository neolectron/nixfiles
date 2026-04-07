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
        jack.enable = false;
      };
    };

  # Home Manager side: audio control tools
  flake.modules.homeManager.sound =
    { pkgs, ... }:
    {
      home.packages = with pkgs; [
        pavucontrol
      ];
    };
}
