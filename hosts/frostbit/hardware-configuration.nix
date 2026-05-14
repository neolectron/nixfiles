{ ... }:
{
  flake.modules.nixos.frostbitHardwareConfiguration =
    {
      config,
      lib,
      modulesPath,
      ...
    }:
    {
      imports = [
        (modulesPath + "/installer/scan/not-detected.nix")
      ];

      boot.initrd.availableKernelModules = [
        "nvme"
        "xhci_pci"
        "ahci"
        "usb_storage"
        "usbhid"
        "sd_mod"
      ];
      boot.initrd.kernelModules = [ ];
      boot.kernelModules = [ "kvm-amd" ];
      boot.extraModulePackages = [ ];

      fileSystems."/" = {
        device = "/dev/disk/by-uuid/4697aaef-dc54-4a5f-82b2-7bf87e4d20f2";
        fsType = "ext4";
      };

      fileSystems."/boot" = {
        device = "/dev/disk/by-uuid/2308-A7A1";
        fsType = "vfat";
        options = [
          "fmask=0077"
          "dmask=0077"
        ];
      };

      # Data drive (Crucial MX500 1.8TB SATA — reformatted ext4)
      fileSystems."/mnt/data" = {
        device = "/dev/disk/by-uuid/c919f4e4-7751-4adf-a443-6709557a3618";
        fsType = "ext4";
        options = [
          "defaults"
          "noatime"
          "nofail"
        ];
      };

      # Windows system drive (Crucial P3 Plus NVMe — "System")
      fileSystems."/mnt/windows" = {
        device = "/dev/disk/by-uuid/78E69A0BE699C9B0";
        fsType = "ntfs-3g";
        options = [
          "rw"
          "uid=1000"
          "gid=100"
          "dmask=022"
          "fmask=133"
          "nofail"
        ];
      };

      swapDevices = [
        { device = "/dev/disk/by-uuid/cd40882d-e48e-462c-a41a-5bd2365c7a50"; }
      ];

      nixpkgs.hostPlatform = lib.mkDefault "x86_64-linux";
      hardware.cpu.amd.updateMicrocode = lib.mkDefault config.hardware.enableRedistributableFirmware;
    };
}
