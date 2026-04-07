{ ... }:
{
  flake.modules.nixos.gaming =
    { pkgs, ... }:
    {
      programs.steam = {
        enable = true;
        remotePlay.openFirewall = true;
        protontricks.enable = true;
        extraCompatPackages = with pkgs; [ proton-ge-bin ];
      };

      programs.gamemode.enable = true;
    };
}
