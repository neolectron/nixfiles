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
    { pkgs, lib, ... }:
    {
      programs.obs-studio = {
        enable = true;

        # Force the X11 (xcb) Qt platform. Some OBS features we rely on
        # are missing under the Wayland platform plugin, so we always
        # run under XWayland regardless of how OBS is launched:
        #   - the desktop launcher (`.desktop` Exec=obs goes through PATH)
        #   - a manual `obs` invocation in a terminal
        # The HM obs-studio module re-wraps this package via `wrapOBS`
        # to inject plugins; that outer wrapper calls this inner one, so
        # the env is still applied before the real obs binary runs.
        package = lib.mkDefault (
          pkgs.symlinkJoin {
            name = "obs-studio-qt-xcb";
            paths = [ pkgs.obs-studio ];
            nativeBuildInputs = [ pkgs.makeWrapper ];
            postBuild = ''
              wrapProgram $out/bin/obs --set QT_QPA_PLATFORM xcb
            '';
            meta = pkgs.obs-studio.meta // { mainProgram = "obs"; };
          }
        );

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
