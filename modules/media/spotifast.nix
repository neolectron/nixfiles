{ inputs, ... }:
{
  flake.modules.nixos.spotifast =
    { pkgs, ... }:
    let
      system = pkgs.stdenv.hostPlatform.system;
      upstreamPackage = inputs.spotifast.packages.${system}.default;
      fontPackage = pkgs.symlinkJoin {
        name = "${upstreamPackage.name}-cjk-fonts";
        paths = [ upstreamPackage ];
        nativeBuildInputs = [ pkgs.makeWrapper ];
        postBuild = ''
          wrapProgram "$out/bin/spotifast" \
            --prefix XDG_DATA_DIRS : "${pkgs.noto-fonts-cjk-sans}/share"
        '';
        inherit (upstreamPackage) meta;
      };
    in
    {
      # fastframe-fonts only scans four directory levels. Fontconfig lists
      # store roots; CJK files live one level too deep there. XDG starts its
      # scan at share/fonts, making the installed collection discoverable.
      environment.systemPackages = [ fontPackage ];
    };
}
