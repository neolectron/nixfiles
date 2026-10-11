{
  appimageTools ? null,
  bun,
  fetchurl,
  lib,
  stdenvNoCC,
  updateScriptZod,
}:

let
  sources = {
    "x86_64-linux" = {
      suffix = "-linux-x86_64.AppImage";
      hash = "sha256-T1CkDdHWLjInuRxsKzE0TfQSphAEvl5R1z3UAVh6TcY=";
    };
  };
  source = sources.${stdenvNoCC.hostPlatform.system};

  finalAttrs = rec {
    pname = "wifi-audio-streaming";
    version = "1.2.0";
    releaseTag = "v1.2";

    src = fetchurl {
      url = "https://github.com/marcomorosi06/WiFiAudioStreaming-Desktop/releases/download/${finalAttrs.releaseTag}/WiFi-Audio-Streaming-${finalAttrs.version}${source.suffix}";
      hash = source.hash;
    };

    passthru.updateScript = [
      (lib.getExe bun)
      ./update.ts
      "${updateScriptZod}/index.js"
    ];

    meta = {
      description = "Stream audio between devices over a local network";
      homepage = "https://github.com/marcomorosi06/WiFiAudioStreaming-Desktop";
      changelog = "https://github.com/marcomorosi06/WiFiAudioStreaming-Desktop/releases/tag/${finalAttrs.releaseTag}";
      license = lib.licenses.eupl12;
      mainProgram = "wifi-audio-streaming";
      platforms = builtins.attrNames sources;
    };
  };
in
appimageTools.wrapType2 (
  finalAttrs
  // {
    # The bundled Java AWT runtime uses X11. Its GTK tray helper crashes when
    # GTK selects Wayland independently of AWT.
    profile = ''
      export GDK_BACKEND=x11
    '';

    extraPkgs = pkgs: [
      pkgs.libsecret
      pkgs.libpulseaudio
      pkgs.libappindicator-gtk3
    ];
  }
)
