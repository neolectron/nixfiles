{ ... }:
{
  flake.modules.homeManager.curseforge =
    { pkgs, ... }:
    let
      version = "1.300.0";
      build = "31983";

      src = pkgs.fetchurl {
        url = "https://curseforge.overwolf.com/electron/linux/CurseForge-${version}-${build}.AppImage";
        sha256 = "02dxs44633n8rin39c07i5dxx81dy2bylwdjd165cxcdch84x69d";
      };

      extracted = pkgs.appimageTools.extractType2 {
        pname = "curseforge";
        inherit version src;
      };

      curseforge = pkgs.appimageTools.wrapType2 {
        pname = "curseforge";
        inherit version src;
      };
    in
    {
      home.packages = [ curseforge ];

      # Some launchers (including Vicinae setups) index ~/.local/share/applications only.
      # Write the desktop file there explicitly, and use absolute Exec path.
      home.file.".local/share/applications/curseforge.desktop".text = ''
        [Desktop Entry]
        Categories=Utility
        Comment=The Easiest Way to Manage Your Mods
        Exec=${curseforge}/bin/curseforge %U
        GenericName=CurseForge
        Icon=${extracted}/usr/share/icons/hicolor/512x512/apps/curseforge.png
        MimeType=x-scheme-handler/curseforge;x-scheme-handler/cfauth;x-scheme-handler/curseforge-checkout
        Name=CurseForge
        StartupWMClass=CurseForge
        Terminal=false
        Type=Application
        Version=1.5
        X-AppImage-Version=${version}-${build}.${build}
      '';
    };
}
