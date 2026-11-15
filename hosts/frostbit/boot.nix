{ ... }:
{
  flake.modules.nixos.frostbit-boot =
    { pkgs, ... }:
    {
      # Boot
      boot.tmp.cleanOnBoot = true; # Clean /tmp on reboot (prevents stale lockfiles/sockets)

      # Kernel 7.0.0 broke r8169 (Realtek RTL8168h) transmit; 7.0.x fixed it.
      # If the NIC links up but sends nothing, pin an older kernel here.
      boot.kernelPackages = pkgs.linuxPackages_latest;
      boot.supportedFilesystems = [ "ntfs" ];
      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;

      # Dual-boot: Windows on separate NVMe disk (Crucial P3 Plus)
      # Uses EDK2 UEFI Shell to chainload Windows Boot Manager from the NVMe ESP.
      # To find the efiDeviceHandle:
      #   1. nixos-rebuild boot, reboot, select "EDK2 UEFI Shell"
      #   2. Run: map -c
      #   3. Try: ls HDXcY:\EFI  (look for one containing Microsoft\)
      #   4. Verify: HDXcY:\EFI\Microsoft\Boot\Bootmgfw.efi
      #   5. Set the handle below and nixos-rebuild switch
      boot.loader.systemd-boot.edk2-uefi-shell.enable = true;
      boot.loader.systemd-boot.windows."windows" = {
        title = "Windows";
        efiDeviceHandle = "PLACEHOLDER"; # TODO: replace after UEFI shell discovery
      };
      wslMount.enable = true;
      wslMount.path = "/mnt/windows/Users/manu/AppData/Local/Packages/22955VineelSai.ArchWSL_qz230bc1wsk9j/LocalState/ext4.vhdx";
    };
}
