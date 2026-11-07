{ ... }:
{
  flake.modules.nixos.sunshine =
    { lib, ... }:
    {
      # Sunshine game-streaming server. The host uses AMD graphics, so the
      # NVIDIA/CUDA package override used by VincentHD is not applicable.
      services.sunshine = {
        enable = true;
        # Installed and ready, but started manually (systemctl --user start sunshine).
        autoStart = lib.mkDefault false;
        capSysAdmin = true;
        openFirewall = true;
      };
    };
}
