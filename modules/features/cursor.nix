{ ... }:
{
  # Home Manager side: cursor theme for Wayland + GTK apps
  flake.modules.homeManager.cursor =
    { pkgs, ... }:
    {
      home.pointerCursor = {
        name = "Adwaita";
        package = pkgs.adwaita-icon-theme;
        size = 24;
        gtk.enable = true;
      };

      # Let HM manage GTK settings so cursor theme propagates to GTK apps
      gtk.enable = true;
    };
}
