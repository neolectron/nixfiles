{ inputs, config, ... }:
{
  # NixOS side: GPU hardware acceleration (AMD)
  flake.modules.nixos.graphics =
    { pkgs, ... }:
    {
      # Enable GPU acceleration (mesa, Vulkan, VA-API)
      hardware.graphics = {
        enable = true;
        enable32Bit = true;
      };

      # AMD GPU driver
      services.xserver.videoDrivers = [ "amdgpu" ];

      # Useful GPU diagnostics tools
      environment.systemPackages = with pkgs; [
        pciutils
      ];
    };
}
