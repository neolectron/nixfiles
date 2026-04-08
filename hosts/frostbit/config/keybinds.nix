{ ... }:
{
  flake.modules.homeManager.frostbitKeybinds =
    { ... }:
    {
      programs.niri.settings.binds = {
        "Mod+Tab" = {
          action.toggle-overview = [ ];
        };
      };
    };
}
