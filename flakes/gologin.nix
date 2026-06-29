{ ... }:
{
  flake.modules.homeManager.gologin =
    { config, lib, pkgs, ... }:
    let
      gologinApp = "${config.home.homeDirectory}/Downloads/Gologin-4.3.1";
    in
    {
      home.packages = [
        (pkgs.writeShellScriptBin "gologin" ''
          exec ${pkgs.appimage-run}/bin/appimage-run ${lib.escapeShellArg gologinApp} "$@"
        '')
      ];

      xdg.desktopEntries.gologin = {
        name = "GoLogin";
        exec = "gologin %u";
        terminal = false;
        mimeType = [ "x-scheme-handler/gologin" ];
        categories = [ "Network" ];
      };

      xdg.mimeApps.enable = true;
      xdg.mimeApps.associations.added = {
        "x-scheme-handler/gologin" = [ "gologin.desktop" ];
      };
      xdg.mimeApps.defaultApplications = {
        "x-scheme-handler/gologin" = [ "gologin.desktop" ];
      };

      xdg.portal.enable = true;
      xdg.portal.extraPortals = [
        pkgs.xdg-desktop-portal-gtk
        pkgs.xdg-desktop-portal-wlr
      ];
      xdg.portal.xdgOpenUsePortal = true;
    };
}
