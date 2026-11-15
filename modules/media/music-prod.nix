{ ... }:
{
  flake.modules.homeManager.music-prod =
    { pkgs, ... }:
    {
      home.packages = [
        # DAW
        pkgs.reaper

        # Windows VST2/VST3 bridge
        pkgs.yabridge
        pkgs.yabridgectl
      ];
    };
}
