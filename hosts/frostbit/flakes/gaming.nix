{ ... }:
{
  flake.modules.homeManager.frostbitgames =
    { pkgs, ... }:
    let
      # nixpkgs d4f25a3: sqlx-macros links -lsqlite3, but modrinth-app-unwrapped 0.21.6
      # does not list sqlite in buildInputs. Drop this override once nixpkgs adds it.
      modrinth-app = pkgs.modrinth-app.override {
        modrinth-app-unwrapped = pkgs.modrinth-app-unwrapped.overrideAttrs (old: {
          buildInputs = old.buildInputs ++ [ pkgs.sqlite ];
        });
      };
    in
    {
      home.packages = [
        modrinth-app
        pkgs.protonup-qt
        pkgs.protonplus
        pkgs.heroic
        pkgs.lutris
        pkgs.bottles
        pkgs.umu-launcher
      ];
    };
}
