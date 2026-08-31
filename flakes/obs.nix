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
    let
      # Nixpkgs has Aitum's standalone Multistream plugin, but not the
      # combined Stream Suite release yet. Package the upstream Linux build
      # in the layout Home Manager's OBS wrapper expects.
      aitum-stream-suite = pkgs.stdenvNoCC.mkDerivation rec {
        pname = "obs-aitum-stream-suite";
        version = "1.2.1";

        src = pkgs.fetchurl {
          url = "https://github.com/Aitum/obs-aitum-stream-suite/releases/download/${version}/aitum-stream-suite-linux-gnu.deb";
          hash = "sha256-IlCLY4hNuxI1GC/ODiOdAMYTYmrQrMQBGDlmBZuY+ew=";
        };

        nativeBuildInputs = [
          pkgs.autoPatchelfHook
          pkgs.dpkg
        ];
        dontWrapQtApps = true;
        buildInputs = [
          pkgs.curl
          pkgs.obs-studio
          pkgs.qt6.qtbase
        ];

        unpackPhase = "dpkg-deb --extract $src .";
        installPhase = ''
          mkdir -p $out/lib/obs-plugins
          mv usr/lib/x86_64-linux-gnu/obs-plugins/* $out/lib/obs-plugins/
          cp -r usr/share $out/
        '';

        meta = {
          description = "Aitum Stream Suite plugin for OBS Studio";
          homepage = "https://aitum.tv/stream-suite";
          platforms = lib.platforms.linux;
        };
      };
    in
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

          # Multi-output and vertical-streaming tools
          aitum-stream-suite
        ];
      };

      # Additional tools for webcam diagnostics
      home.packages = [
        pkgs.v4l-utils          # v4l2-ctl, qv4l2
      ];
    };
}
