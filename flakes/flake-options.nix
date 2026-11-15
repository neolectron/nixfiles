{ lib, ... }:
{
  options.nixfiles.username = lib.mkOption {
    type = lib.types.str;
    description = "Primary username shared across all modules; each host sets it.";
  };

  options.nixfiles.wifiAudioStreaming.autoConnectIps = lib.mkOption {
    type = lib.types.listOf lib.types.str;
    default = [ ];
    description = "LAN addresses that WiFi Audio Streaming should try at login.";
  };

  options.nixfiles.androidPhone.videoNumber = lib.mkOption {
    type = lib.types.ints.unsigned;
    default = 42;
    description = "Stable v4l2loopback video device number for the Android phone camera.";
  };

  options.nixfiles.androidPhone.cameraLabel = lib.mkOption {
    type = lib.types.str;
    default = "Android Phone Camera";
    description = "Stable v4l2loopback camera label shown to desktop applications.";
  };
}
