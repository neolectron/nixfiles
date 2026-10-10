{ lib, ... }:
{
  options.flake.username = lib.mkOption {
    type = lib.types.str;
    default = "your-username";
    description = "Primary username shared across all modules";
  };

  options.flake.wifiAudioStreaming.autoConnectIps = lib.mkOption {
    type = lib.types.listOf lib.types.str;
    default = [ ];
    description = "LAN addresses that WiFi Audio Streaming should try at login.";
  };

  options.flake.androidPhone.videoNumber = lib.mkOption {
    type = lib.types.ints.unsigned;
    default = 42;
    description = "Stable v4l2loopback video device number for the Android phone camera.";
  };

  options.flake.androidPhone.cameraLabel = lib.mkOption {
    type = lib.types.str;
    default = "Android Phone Camera";
    description = "Stable v4l2loopback camera label shown to desktop applications.";
  };
}
