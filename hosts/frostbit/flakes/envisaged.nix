{ inputs, ... }:
{
  # Expose an overlay that adds `envisaged` to pkgs
  flake.overlays.envisaged = final: prev: {
    envisaged = inputs.envisaged.packages.${prev.system}.cli;
  };

  # Module that applies the overlay and installs envisaged
  flake.modules.nixos.envisaged =
    { pkgs, ... }:
    {
      nixpkgs.overlays = [ inputs.self.overlays.envisaged ];
      environment.systemPackages = [ pkgs.envisaged ];
    };
}
