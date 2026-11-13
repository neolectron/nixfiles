{ ... }:
{
  flake.modules.nixos.gaming =
    { pkgs, ... }:
    {
      programs.steam = {
        enable = true;
        remotePlay.openFirewall = true;
        localNetworkGameTransfers.openFirewall = true;
        protontricks.enable = true;
        extraCompatPackages = [ pkgs.proton-ge-bin ];
        package = pkgs.steam.override {
          # Remote Play on Wayland only captures the screen through PipeWire.
          extraArgs = "-pipewire";
          # The Steam client runs in pressure-vessel, which only looks for GBM backends next to
          # libgbm; NixOS keeps dri_gbm.so in the driver directory, so capture fails without this.
          extraEnv.GBM_BACKENDS_PATH = "/run/opengl-driver/lib/gbm:/run/opengl-driver-32/lib/gbm";
        };
      };

      programs.gamescope = {
        enable = true;
        capSysNice = true;
      };

      programs.gamemode.enable = true;

      environment.systemPackages = [
        pkgs.dolphin-emu
        pkgs.mgba
      ];
    };
}
