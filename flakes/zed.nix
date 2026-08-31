{ ... }:
{
  # Home Manager: a Nix-managed Zed setup with familiar VS Code-style defaults.
  flake.modules.homeManager.zed =
    { pkgs, ... }:
    {
      home.packages = [ pkgs.zed-editor ];

      xdg.configFile = {
        "zed/settings.json".source = ../assets/zed/settings.json;
        "zed/keymap.json".source = ../assets/zed/keymap.json;
      };
    };
}
