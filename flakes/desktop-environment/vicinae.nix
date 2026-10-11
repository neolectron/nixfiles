{ inputs, ... }:
{
  flake.modules.homeManager.vicinae =
    {
      lib,
      pkgs,
      ...
    }:
    let
      system = pkgs.stdenv.hostPlatform.system;
      upstreamPackage = inputs.vicinae.packages.${system}.default;
      mesa = inputs.vicinae.inputs.nixpkgs.legacyPackages.${system}.mesa;
      compatiblePackage = pkgs.symlinkJoin {
        name = "${upstreamPackage.name}-compatible-graphics";
        paths = [ upstreamPackage ];
        nativeBuildInputs = [ pkgs.makeWrapper ];
        postBuild = ''
          wrapProgram "$out/bin/vicinae" \
            --set __EGL_VENDOR_LIBRARY_FILENAMES "${mesa}/share/glvnd/egl_vendor.d/50_mesa.json"
        '';
        inherit (upstreamPackage) meta;
      };
    in
    {
      imports = [
        inputs.vicinae.homeManagerModules.default
      ];

      programs.vicinae = {
        enable = true;
        # Mesa is loaded into the cached app's process, so use its package set's
        # driver rather than a host driver requiring newer glibc symbols.
        package = lib.mkDefault compatiblePackage;
        systemd = {
          enable = true;
          autoStart = true;
          environment = {
            USE_LAYER_SHELL = 1;
          };
        };
        settings = {
          telemetry.system_info = false;
        };
        extensions = with inputs.vicinae-extensions.packages.${pkgs.stdenv.hostPlatform.system}; [
          nix
        ];
      };
    };
}
