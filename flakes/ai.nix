{ config, lib, ... }:
{
  # Option to configure opencode server hostname
  options.flake.opencode.hostname = lib.mkOption {
    type = lib.types.str;
    default = "127.0.0.1";
    description = "Hostname for opencode server to bind to (default: localhost only)";
  };

  config.flake.modules.homeManager.coding =
    { pkgs, ... }:
    let
      # Get hostname from flake option
      hostname = config.flake.opencode.hostname;

      opencode-bin = "${pkgs.opencode}/bin/opencode";

      # Wrapper: bare `opencode` attaches to the running service with the current directory.
      # Any subcommand (run, serve, auth, …) is passed through to the real binary unchanged.
      opencode-wrapper = pkgs.writeShellScriptBin "opencode" ''
        if [ $# -gt 0 ]; then
          exec ${opencode-bin} "$@"
        fi
        exec ${opencode-bin} attach http://localhost:4096 --dir "$PWD"
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
          ExecStart = "${opencode-bin} serve --hostname ${hostname} --port 4096";
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
