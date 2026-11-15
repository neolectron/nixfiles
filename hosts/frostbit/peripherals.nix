{ ... }:
{
  flake.modules.nixos.frostbit-peripherals =
    { pkgs, ... }:
    {
      # ZSA Moonlander / Oryx flashing support
      hardware.keyboard.zsa.enable = true;

      # Gaming mouse configuration (Logitech G502 HERO)
      # Enables ratbagd as a system service so ratbagctl works without sudo.
      services.ratbagd.enable = true;
      environment.systemPackages = [ pkgs.piper ];
    };
}
