{ ... }:
{
  flake.modules.homeManager.chatgpt =
    { pkgs, ... }:
    let
      chatgpt-unwrapped = pkgs.stdenvNoCC.mkDerivation {
        pname = "chatgpt";
        version = "26.715.70719";

        src = pkgs.fetchurl {
          url = "https://persistent.oaistatic.com/codex-app-prod/linux/deb/latest/chatgpt_amd64.deb";
          hash = "sha256-qb+Ro2j598Tuo4CCqfuPtGuNAFtxmm13FdLloZgsOOs=";
        };

        nativeBuildInputs = [ pkgs.dpkg ];
        unpackPhase = "dpkg-deb --extract $src .";
        installPhase = ''
          install -Dm755 usr/lib/chatgpt/ChatGPT $out/libexec/chatgpt/ChatGPT
          cp -r usr/lib/chatgpt/. $out/libexec/chatgpt/
        '';
      };

      chatgpt = pkgs.buildFHSEnv {
        name = "chatgpt-desktop";
        runScript = "${chatgpt-unwrapped}/libexec/chatgpt/ChatGPT";
        targetPkgs = pkgs: with pkgs; [
          alsa-lib
          atk
          at-spi2-atk
          cairo
          cups
          dbus
          expat
          fontconfig
          freetype
          gdk-pixbuf
          glib
          gtk3
          libdrm
          libglvnd
          libnotify
          libpulseaudio
          libuuid
          libx11
          libxcb
          libxcomposite
          libxdamage
          libxext
          libxfixes
          libxkbcommon
          libxrandr
          mesa
          nspr
          nss
          pango
          systemdLibs
        ];
      };
    in
    {
      home.packages = [ chatgpt ];

      xdg.desktopEntries.chatgpt = {
        name = "ChatGPT";
        comment = "ChatGPT desktop app with Codex";
        exec = "chatgpt-desktop %U";
        terminal = false;
        categories = [ "Utility" "Development" ];
      };
    };
}
