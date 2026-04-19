{ ... }:
{
  flake.modules.homeManager.chataigne =
    { pkgs, ... }:
    let
      pname = "chataigne";
      version = "1.10.3";

      src = pkgs.fetchurl {
        url = "https://benjamin.kuperberg.fr/chataigne/user/data/Chataigne-linux-x64-1.10.3.AppImage";
        hash = "sha256-QrXWc/NKKa3YC9IRrMJYp/UtUtbx9bTYVS+nZwH50kQ=";
      };

      appimageContents = pkgs.appimageTools.extractType2 {
        inherit
          pname
          version
          src
          ;
      };

      chataigne = pkgs.appimageTools.wrapType2 {
        inherit
          pname
          version
          src
          ;

        # Runtime dependencies Chataigne needs inside the FHS sandbox
        extraPkgs =
          pkgs: with pkgs; [
            # Audio & MIDI
            alsa-lib
            libjack2

            # Bluetooth (Wiimote, Joycon support)
            bluez

            # Graphics / GUI (JUCE)
            freetype
            libGL
            mesa
            libx11
            libxcursor
            libxinerama
            libxrandr
            libxcomposite
            libxext
            libxrender
            gtk3

            # Networking (HTTP, MQTT, WebSocket)
            curl

            # USB / HID (StreamDeck, Loupedeck, controllers)
            libusb1
            hidapi

            # Gamepad / Joystick
            SDL2

            # Misc
            lz4
            libbsd
            fuse
          ];

        extraInstallCommands = ''
          install -Dm444 ${appimageContents}/chataigne.desktop \
            $out/share/applications/chataigne.desktop
          substituteInPlace $out/share/applications/chataigne.desktop \
            --replace-fail 'Exec=Chataigne' 'Exec=chataigne'
          install -Dm444 ${appimageContents}/chataigne.png \
            $out/share/icons/hicolor/512x512/apps/chataigne.png
        '';
      };
    in
    {
      home.packages = [ chataigne ];

      # Vicinae watches ~/.local/share/applications and rescans on changes.
      # Installing an explicit HM desktop entry guarantees discovery there.
      xdg.desktopEntries.chataigne = {
        name = "Chataigne";
        exec = "chataigne";
        icon = "${chataigne}/share/icons/hicolor/512x512/apps/chataigne.png";
        terminal = false;
        type = "Application";
        categories = [
          "AudioVideo"
          "Art"
        ];
        comment = "Artist friendly Modular Machine for Art and Technology";
        startupNotify = true;
      };
    };
}
