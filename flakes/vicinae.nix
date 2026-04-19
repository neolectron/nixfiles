{ inputs, ... }:
{
  flake.modules.homeManager.vicinae =
    {
      lib,
      pkgs,
      ...
    }:
    {
      imports = [
        inputs.vicinae.homeManagerModules.default
      ];

      services.vicinae = {
        enable = true;
        systemd = {
          enable = true;
          autoStart = true;
          environment = {
            USE_LAYER_SHELL = 1;
          };
        };
        settings = {
          telemetry.system_info = false;
        };
        extensions = with inputs.vicinae-extensions.packages.${pkgs.stdenv.hostPlatform.system}; [
          nix
        ];
      };
    };
}
