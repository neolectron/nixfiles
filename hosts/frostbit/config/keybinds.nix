{ ... }:
{
  config.flake.modules.homeManager.frostbitKeybinds =
    { ... }:
    {
      # it's possible to split default.nix like this.
      programs.niri.settings.binds = {
        # "Mod+Tab" = {
        #   action.toggle-overview = [ ];
        # };
      };
    };
}
