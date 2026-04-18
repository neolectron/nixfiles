{ config, ... }:
{
  flake.modules.homeManager.coding =
    {
      pkgs,
      ...
    }:
    let
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

      # OpenCode headless server — always running, reachable at http://localhost:4096
      # Starts after graphical-session.target so niri-session has already run
      # `systemctl --user import-environment`, giving us the full NixOS PATH.
      systemd.user.services.opencode = {
        Unit = {
          Description = "Shared OpenCode backend";
          After = [ "graphical-session.target" ];
        };
        Service = {
          Type = "simple";
          ExecStart = "${opencode-bin} serve";
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
