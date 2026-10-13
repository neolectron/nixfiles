# Standalone development shell; not imported by flake-parts or activated.
let
  # Git's source filter excludes .git and node_modules; a plain path flakes
  # snapshot copies them into the store on every development edit.
  flake = builtins.getFlake "git+file://${toString ../..}";
  pkgs = flake.inputs.nixpkgs.legacyPackages.${builtins.currentSystem};
in
pkgs.mkShell {
  packages = [
    pkgs.nodejs_24
    pkgs.pnpm
    pkgs.usbutils
    pkgs.pulseaudio # pactl controls PipeWire's existing PulseAudio interface.
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
