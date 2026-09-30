{ config, lib, ... }:
{
  # Option to configure opencode server hostname
  options.flake.opencode.hostname = lib.mkOption {
    type = lib.types.str;
    default = "127.0.0.1";
    description = "Hostname for opencode server to bind to (default: localhost only)";
  };
  options.flake.opencode.database = lib.mkOption {
    type = lib.types.str;
    default = "opencode-v2.db";
    description = "Database file for the OpenCode 2 service";
  };

  config.flake.modules.homeManager.coding =
    { pkgs, lib, ... }:
    let
      # Get hostname from flake option
      hostname = config.flake.opencode.hostname;

      opencode-v2 = pkgs.callPackage ../packages/opencode-v2 { };
      opencode-bin = "${opencode-v2}/bin/opencode";
      opencode-db = config.flake.opencode.database;

      # Wrapper: bare `opencode` opens the current directory using the shared service.
      # Any subcommand (run, serve, auth, …) is passed through to the real binary unchanged.
      opencode-wrapper = pkgs.writeShellScriptBin "opencode" ''
        export OPENCODE_DB=${opencode-db}
        if [ $# -gt 0 ]; then
          exec ${opencode-bin} "$@"
        fi
        exec ${opencode-bin} "$PWD"
      '';
    in
    {
      home.packages = [ opencode-wrapper ];

      # OpenCode headless server — always running
      # Defaults to localhost only (127.0.0.1). Set flake.opencode.hostname = "0.0.0.0" for LAN access.
      # Starts after graphical-session.target so niri-session has already run
      # `systemctl --user import-environment`, giving us the full NixOS PATH.
      systemd.user.services.opencode = {
        Unit = {
          Description = "Shared OpenCode backend";
          After = [ "graphical-session.target" ];
        };
        Service = {
          Type = "simple";
          Environment = "OPENCODE_DB=${opencode-db}";
          ExecStart = "${opencode-bin} serve --service --hostname ${hostname} --port 4096";
          Restart = "always";
          RestartSec = "2";
          WorkingDirectory = "%h";
        };
        Install = {
          WantedBy = [ "graphical-session.target" ];
        };
      };

    };
}
