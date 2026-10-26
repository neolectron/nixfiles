{ inputs, ... }:
{
  flake.modules.nixos.spotifast =
    { pkgs, ... }:
    let
      system = pkgs.stdenv.hostPlatform.system;
      upstreamPackage = inputs.spotifast.packages.${system}.default;
      mesa = inputs.spotifast.inputs.nixpkgs.legacyPackages.${system}.mesa;
      compatiblePackage = pkgs.symlinkJoin {
        name = "${upstreamPackage.name}-compatible-graphics";
        paths = [ upstreamPackage ];
        nativeBuildInputs = [ pkgs.makeWrapper ];
        postBuild = ''
          wrapProgram "$out/bin/spotifast" \
            --prefix XDG_DATA_DIRS : "${pkgs.noto-fonts-cjk-sans}/share" \
            --set __EGL_VENDOR_LIBRARY_FILENAMES "${mesa}/share/glvnd/egl_vendor.d/50_mesa.json"
        '';
        inherit (upstreamPackage) meta;
      };
    in
    {
      # The upstream binary must load Mesa built against its own glibc.
      # fastframe-fonts only scans four directory levels. Fontconfig lists
      # store roots; CJK files live one level too deep there. XDG starts its
      # scan at share/fonts, making the installed collection discoverable.
      environment.systemPackages = [ compatiblePackage ];
    };
}
