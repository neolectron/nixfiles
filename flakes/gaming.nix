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
      };

      programs.gamescope = {
        enable = true;
        capSysNice = true;
      };

      programs.gamemode.enable = true;

      environment.systemPackages = [ pkgs.dolphin-emu ];
    };
}
