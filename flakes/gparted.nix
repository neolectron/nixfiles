{
  flake.modules.nixos.gparted = { pkgs, ... }:
  let
    gparted-wrapper = pkgs.writeShellScriptBin "gparted" ''
      exec sudo -E ${pkgs.gparted}/bin/gparted "$@"
    '';
  in
  {
    environment.systemPackages = [
      gparted-wrapper
      (pkgs.lib.lowPrio pkgs.gparted)
    ];
  };
}
