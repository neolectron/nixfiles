{ ... }:
{
  flake.modules.nixos.locale =
    { pkgs, ... }:
    {
      # Timezone & locale
      time.timeZone = "Europe/Paris";
      i18n.defaultLocale = "en_US.UTF-8";
      i18n.extraLocaleSettings = {
        LC_ADDRESS = "fr_FR.UTF-8";
        LC_IDENTIFICATION = "fr_FR.UTF-8";
        LC_MEASUREMENT = "fr_FR.UTF-8";
        LC_MONETARY = "fr_FR.UTF-8";
        LC_NAME = "fr_FR.UTF-8";
        LC_NUMERIC = "fr_FR.UTF-8";
        LC_PAPER = "fr_FR.UTF-8";
        LC_TELEPHONE = "fr_FR.UTF-8";
        LC_TIME = "fr_FR.UTF-8";
      };

      # Keyboard layout — qwerty-fr (QWERTY with French accents via AltGr)
      services.xserver.xkb = {
        layout = "us_qwerty-fr";
        variant = "qwerty-fr";
        extraLayouts.us_qwerty-fr = {
          description = "US QWERTY with French accents";
          languages = [
            "eng"
            "fra"
          ];
          symbolsFile = "${pkgs.qwerty-fr}/share/X11/xkb/symbols/us_qwerty-fr";
        };
      };
    };
}
