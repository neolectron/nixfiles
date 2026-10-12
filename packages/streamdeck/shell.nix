# Standalone development shell; not imported by flake-parts or activated.
let
  flake = builtins.getFlake (toString ../..);
  pkgs = flake.inputs.nixpkgs.legacyPackages.${builtins.currentSystem};
in
pkgs.mkShell {
  packages = [
    pkgs.nodejs_24
    pkgs.pnpm
    pkgs.usbutils
    pkgs.pkg-config
    pkgs.python3
  ];
  buildInputs = [
    pkgs.libusb1
    pkgs.udev
  ];
  # node-hid's prebuilt hidraw addon dlopens libudev on NixOS.
  LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [
    pkgs.udev
    pkgs.libusb1
    pkgs.stdenv.cc.cc.lib
  ];
}
