{ ... }:
{
  # Home Manager side: cursor theme for Wayland + GTK apps
  flake.modules.homeManager.cursor =
    { pkgs, lib, ... }:
    {
      home.pointerCursor = {
        name = lib.mkDefault "Adwaita";
        package = lib.mkDefault pkgs.adwaita-icon-theme;
        size = lib.mkDefault 24;
        gtk.enable = true;
      };

      # Let HM manage GTK settings so cursor theme propagates to GTK apps
      gtk.enable = true;
    };
}
