{ inputs, ... }:
let
  package =
    inputs.nixpkgs.legacyPackages.x86_64-linux.callPackage ../packages/streamdeck/default.nix
      { };
in
{
  flake.packages.x86_64-linux.streamdeck-studio = package;
  flake.checks.x86_64-linux.streamdeck-studio = package;
  flake.modules.homeManager.streamdeck =
    {
      pkgs,
      lib,
      config,
      ...
    }:
    let
      package = pkgs.callPackage ../packages/streamdeck/default.nix { };
    in
    {
      home.packages = [ package ];
      systemd.user.services.streamdeck-studio = {
        Unit = {
          Description = "Stream Deck Studio";
          After = [
            "graphical-session.target"
            "pipewire-pulse.service"
          ];
          PartOf = [ "graphical-session.target" ];
          StartLimitIntervalSec = 0;
        };
        Service = {
          Type = "simple";
          WorkingDirectory = "%h";
          StateDirectory = "streamdeck-studio";
          StateDirectoryMode = "0700";
          ExecStart = lib.mkDefault "${lib.getExe package} studio --production --profile %S/streamdeck-studio/profile.json";
          # Effect reports graceful interruption as 130 (SIGINT) or 143 (SIGTERM).
          SuccessExitStatus = [
            130
            143
          ];
          Restart = "always";
          RestartSec = 3;
          TimeoutStopSec = 15;
          UMask = "0077";
          Environment = [
            "PATH=${
              lib.makeBinPath [
                pkgs.pulseaudio
                pkgs.glib
                pkgs.systemd
                pkgs.wtype
                pkgs.wl-clipboard
              ]
            }:${config.home.profileDirectory}/bin:/run/current-system/sw/bin"
          ];
        };
        Install.WantedBy = [ "graphical-session.target" ];
      };
    };
}
