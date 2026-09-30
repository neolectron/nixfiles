{ inputs, ... }:
{
  flake.modules.homeManager.humanlayer =
    { pkgs, ... }:
    {
      home.packages = [
        inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.humanlayer-cli
      ];
    };
}
