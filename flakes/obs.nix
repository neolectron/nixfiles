{ inputs, config, ... }:
let
  username = config.flake.username;
in
{
  # ── NixOS: v4l2loopback kernel module for OBS virtual camera ─
  flake.modules.nixos.obs =
    { pkgs, ... }:
    {
      programs.obs-studio.enableVirtualCamera = true;
    };

  # ── Home Manager: OBS Studio with plugins ─────────────────
  flake.modules.homeManager.obs =
    { pkgs, ... }:
    {
      programs.obs-studio = {
        enable = true;

        plugins = with pkgs.obs-studio-plugins; [
          # Wayland screen capture (for niri)
          wlrobs

          # PipeWire audio capture (better than PulseAudio)
          obs-pipewire-audio-capture

          # VA-API hardware encoding (AMD GPU)
          obs-vaapi

          # Advanced scene switcher
          advanced-scene-switcher
        ];
      };

      # Additional tools for webcam diagnostics
      home.packages = [
        pkgs.v4l-utils          # v4l2-ctl, qv4l2
      ];
    };
}
