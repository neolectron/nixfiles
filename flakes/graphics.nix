{ inputs, config, ... }:
{
  # NixOS side: GPU hardware acceleration (AMD)
  flake.modules.nixos.graphics =
    { pkgs, lib, ... }:
    {
      # Enable GPU acceleration (mesa, Vulkan, VA-API)
      hardware.graphics = {
        enable = true;
        enable32Bit = true;
      };

      # AMD GPU driver
      services.xserver.videoDrivers = [ "amdgpu" ];

      # Load amdgpu in initrd for early KMS / proper boot resolution
      boot.initrd.kernelModules = [ "amdgpu" ];

      # AMD GPU hardware-specific settings
      hardware.amdgpu.initrd.enable = lib.mkDefault true;
      hardware.amdgpu.opencl.enable = lib.mkDefault true;

      # Useful GPU diagnostics tools
      environment.systemPackages = with pkgs; [
        pciutils
        radeontop
      ];
    };
}
