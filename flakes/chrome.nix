{ ... }:
{
  flake.modules.homeManager.google-chrome =
    { pkgs, ... }:
    {
      home.packages = [ pkgs.google-chrome ];
    };
}
