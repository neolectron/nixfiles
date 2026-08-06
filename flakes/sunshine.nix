{ ... }:
{
  flake.modules.nixos.sunshine =
    { ... }:
    {
      # Sunshine game-streaming server. The host uses AMD graphics, so the
      # NVIDIA/CUDA package override used by VincentHD is not applicable.
      services.sunshine = {
        enable = true;
        capSysAdmin = true;
        openFirewall = true;
      };
    };
}
