{ ... }:
{
  flake.modules.homeManager.dolphin =
    { pkgs, lib, ... }:
    {
      home.packages = [ pkgs.kdePackages.dolphin ];

      # Folder links and portal OpenDirectory requests should open Dolphin.
      xdg.mimeApps = {
        enable = true;
        associations.added = {
          "inode/directory" = lib.mkDefault [ "org.kde.dolphin.desktop" ];
          "inode/mount-point" = lib.mkDefault [ "org.kde.dolphin.desktop" ];
        };
        defaultApplications = {
          "inode/directory" = lib.mkDefault [ "org.kde.dolphin.desktop" ];
          "inode/mount-point" = lib.mkDefault [ "org.kde.dolphin.desktop" ];
        };
      };
    };
}
