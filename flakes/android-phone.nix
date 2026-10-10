{ inputs, config, ... }:
let
  flakeConfig = config;
  username = config.flake.username;
in
{
  flake.modules.nixos.androidPhone =
    { config, ... }:
    {
      boot.kernelModules = [ "v4l2loopback" ];
      boot.extraModulePackages = [ config.boot.kernelPackages.v4l2loopback ];
      boot.extraModprobeConfig = ''
        options v4l2loopback devices=1 video_nr=${toString flakeConfig.flake.androidPhone.videoNumber} card_label="${flakeConfig.flake.androidPhone.cameraLabel}" exclusive_caps=1
      '';

      users.users.${username}.extraGroups = [ "video" ];
    };

  flake.modules.homeManager.androidPhone =
    { pkgs, lib, ... }:
    let
      droidcam = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.droidcam-client;
      cameraService = "android-phone-camera.service";

      screenMirror = pkgs.writeShellApplication {
        name = "android-screen-mirror";
        runtimeInputs = [ pkgs.scrcpy ];
        text = ''
          exec scrcpy --window-title="Android Screen Mirror" "$@"
        '';
      };

      startCamera = pkgs.writeShellApplication {
        name = "android-phone-camera-start";
        runtimeInputs = [
          pkgs.libnotify
          pkgs.systemd
        ];
        text = ''
          systemctl --user reset-failed ${cameraService} || true
          if ! systemctl --user start ${cameraService}; then
            notify-send "DroidCam" "Could not open the client. Check: journalctl --user -u ${cameraService}" || true
            exit 1
          fi
        '';
      };

      stopCamera = pkgs.writeShellApplication {
        name = "android-phone-camera-stop";
        runtimeInputs = [ pkgs.systemd ];
        text = ''
          systemctl --user stop ${cameraService}
        '';
      };
    in
    {
      home.packages = [
        pkgs.android-tools
        pkgs.scrcpy
        pkgs.v4l-utils
        droidcam
        screenMirror
        startCamera
        stopCamera
      ];

      xdg.desktopEntries.android-screen-mirror = {
        name = "Android Screen Mirror";
        genericName = "Mirror Android screen";
        comment = "Mirror and share the Android screen with scrcpy";
        exec = "${lib.getExe screenMirror}";
        icon = "phone";
        terminal = false;
        categories = [
          "AudioVideo"
          "Video"
        ];
      };

      xdg.desktopEntries."com.dev47apps.droidcam" = {
        name = "DroidCam";
        genericName = "Android phone webcam";
        comment = "Open DroidCam webcam preview and camera controls";
        exec = "${lib.getExe startCamera}";
        icon = "droidcam-client";
        terminal = false;
        categories = [
          "AudioVideo"
          "Video"
        ];
      };

      xdg.desktopEntries.android-phone-camera-stop = {
        name = "DroidCam (Stop)";
        comment = "Close DroidCam and stop the phone webcam";
        exec = "${lib.getExe stopCamera}";
        icon = "camera-web";
        terminal = false;
        categories = [
          "AudioVideo"
          "Video"
        ];
      };

      systemd.user.services.android-phone-camera = {
        Unit = {
          Description = "DroidCam phone webcam and controls";
          After = [ "graphical-session.target" ];
          PartOf = [ "graphical-session.target" ];
        };
        Service = {
          Type = "simple";
          ExecStart = "${lib.getExe droidcam}";
        };
      };
    };
}
