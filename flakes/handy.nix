{ inputs, ... }:
let
  # nixpkgs d4f25a3: the Rust build links -lsqlite3, which the Tauri stack no
  # longer brings in transitively. Drop this once upstream lists sqlite itself.
  handyPackage =
    pkgs:
    inputs.handy.packages.${pkgs.stdenv.hostPlatform.system}.handy.overrideAttrs (old: {
      buildInputs = (old.buildInputs or [ ]) ++ [ pkgs.sqlite ];
    });
in
{
  # NixOS side: udev rule for /dev/uinput + add package to system
  flake.modules.nixos.handy =
    { pkgs, ... }:
    {
      imports = [ inputs.handy.nixosModules.default ];
      programs.handy.enable = true;
      programs.handy.package = handyPackage pkgs;
    };

  # Home Manager side: on-demand systemd user service + niri keybind
  flake.modules.homeManager.handy =
    { lib, pkgs, ... }:
    {
      imports = [ inputs.handy.homeManagerModules.default ];
      services.handy.enable = true;
      services.handy.package = handyPackage pkgs;

      # Keep the user service available, but don't start it with the session.
      systemd.user.services.handy.Install.WantedBy = lib.mkForce [ ];

      # Handy needs wtype to paste transcribed text on Wayland
      home.packages = [ pkgs.wtype ];

      # Wayland: global shortcuts must go through the compositor.
      # Use Unix signals so the keybind works even if handy isn't focused.
      # If Handy isn't running yet, the first press starts it.
      programs.niri.settings.binds."Mod+O" = {
        repeat = false;
        action.spawn = [
          "sh"
          "-c"
          "pkill -USR2 -n handy || systemctl --user start handy.service"
        ];
      };
    };
}
