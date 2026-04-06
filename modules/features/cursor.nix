{ ... }:
{
  # Home Manager side: cursor theme for Wayland + GTK apps
  flake.modules.homeManager.cursor =
    { pkgs, ... }:
    {
      home.pointerCursor = {
        name = "adwaita";
        package = pkgs.adwaita-icon-theme;
        size = 24;
        gtk.enable = true;
      };
    };
}
