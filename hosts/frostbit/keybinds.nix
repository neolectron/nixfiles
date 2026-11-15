{ lib, ... }:
{
  config.flake.modules.homeManager.frostbit-keybinds =
    { ... }:
    {
      # it's possible to split default.nix like this.
      programs.niri.settings.binds = {
        # Toggle Keep Awake / idle inhibitor (prevents sleep/lock/suspend)
        "Mod+Shift+C" = {
          action.spawn = [
            "noctalia"
            "msg"
            "caffeine-toggle"
          ];
        };
      };
    };
}
