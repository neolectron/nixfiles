{ ... }:
{
  # NixOS side: Mount WSL ArchLinux ext4.vhdx via qemu-nbd
  #
  # The WSL distro stores its filesystem inside a VHDX virtual disk image.
  # We use qemu-nbd to expose it as a block device, then mount the ext4
  # partition normally.
  #
  # IMPORTANT: Never mount while Windows/WSL is also using the VHDX.
  #            Concurrent access WILL corrupt the filesystem.
  #
  # Usage:
  #   wsl-mount          Mount ArchWSL to /mnt/wsl (read-write)
  #   wsl-umount         Unmount and disconnect cleanly
  flake.modules.nixos.wslMount =
    { pkgs, ... }:
    let
      vhdxPath = "/mnt/windows/Users/manu/AppData/Local/Packages/22955VineelSai.ArchWSL_qz230bc1wsk9j/LocalState/ext4.vhdx";
      mountPoint = "/mnt/wsl";
      nbdDev = "/dev/nbd0";
    in
    {
      boot.kernelModules = [ "nbd" ];

      systemd.tmpfiles.rules = [
        "d ${mountPoint} 0755 root root -"
      ];

      environment.systemPackages = [
        pkgs.qemu-utils

        (pkgs.writeShellScriptBin "wsl-mount" ''
          set -euo pipefail

          VHDX="${vhdxPath}"
          MOUNT="${mountPoint}"
          DEV="${nbdDev}"

          if mountpoint -q "$MOUNT"; then
            echo "Already mounted at $MOUNT"
            exit 0
          fi

          if [ ! -f "$VHDX" ]; then
            echo "Error: VHDX not found at $VHDX"
            echo "Is the Windows partition mounted at /mnt/windows?"
            exit 1
          fi

          sudo ${pkgs.kmod}/bin/modprobe nbd max_part=8
          sudo ${pkgs.qemu-utils}/bin/qemu-nbd --connect="$DEV" "$VHDX"
          sleep 1

          # Try partition first, fall back to whole device
          if [ -b "''${DEV}p1" ]; then
            sudo mount "''${DEV}p1" "$MOUNT"
          else
            sudo mount "$DEV" "$MOUNT"
          fi

          echo "Mounted WSL ArchLinux at $MOUNT"
        '')

        (pkgs.writeShellScriptBin "wsl-umount" ''
          set -euo pipefail

          MOUNT="${mountPoint}"
          DEV="${nbdDev}"

          if mountpoint -q "$MOUNT"; then
            sudo umount "$MOUNT"
            echo "Unmounted $MOUNT"
          else
            echo "$MOUNT is not mounted"
          fi

          if [ -b "$DEV" ]; then
            sudo ${pkgs.qemu-utils}/bin/qemu-nbd --disconnect "$DEV" 2>/dev/null || true
            echo "Disconnected $DEV"
          fi
        '')
      ];
    };
}
