{ lib, ... }:
{
  config.flake.modules.homeManager.frostbitKeybinds =
    { ... }:
    {
      # it's possible to split default.nix like this.
      programs.niri.settings.binds = {
        # Toggle Keep Awake / idle inhibitor (prevents sleep/lock/suspend)
        "Mod+Shift+C" = {
          action.spawn = [
            "sh"
            "-c"
            "qs -c noctalia-shell ipc call idleInhibitor toggle"
          ];
        };
      };
    };
}
