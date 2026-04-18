{ inputs, ... }:
{
  # NixOS side: udev rule for /dev/uinput + add package to system
  flake.modules.nixos.handy =
    { ... }:
    {
      imports = [ inputs.handy.nixosModules.default ];
      programs.handy.enable = true;
    };

  # Home Manager side: systemd user service for autostart + niri keybind
  flake.modules.homeManager.handy =
    { lib, pkgs, ... }:
    {
      imports = [ inputs.handy.homeManagerModules.default ];
      services.handy.enable = true;

      # Handy needs wtype to paste transcribed text on Wayland
      home.packages = [ pkgs.wtype ];

      # Wayland: global shortcuts must go through the compositor.
      # Use Unix signals so the keybind works even if handy isn't focused.
      programs.niri.settings.binds."Mod+O" = {
        repeat = false;
        action.spawn = [
          "pkill"
          "-USR2"
          "-n"
          "handy"
        ];
      };
    };
}
