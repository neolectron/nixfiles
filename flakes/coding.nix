{ config, ... }:
let
  username = config.flake.username;
in
{
  # NixOS side: nix-ld for VSCode remote extensions and other dynamically-linked tools
  flake.modules.nixos.coding =
    { lib, ... }:
    {
      programs.nix-ld.enable = true;

      # Docker daemon — socket-activated by default (enableOnBoot = false)
      virtualisation.docker.enable = lib.mkDefault true;
      virtualisation.docker.autoPrune.enable = lib.mkDefault true;

      # Let the user run docker without sudo
      users.users.${username}.extraGroups = [ "docker" ];
    };

  # Home Manager side: development tools
  flake.modules.homeManager.coding =
    {
      pkgs,
      config,
      lib,
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
      home.packages = with pkgs; [
        vscode
        opencode-wrapper
        neovim
        tmux
        curl
        jq
        ripgrep
        gh
        nixfmt
        nixd
        (pkgs.google-chrome.override {
          commandLineArgs = [ "--ozone-platform=wayland" ];
        })
        uv
        qdirstat
        htop
        devenv
        docker-compose
      ];

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

      programs.git = {
        enable = true;
        settings = {
          user.name = lib.mkDefault config.home.username;
          user.email = lib.mkDefault "jhon-doe@users.noreply.github.com";
          init.defaultBranch = lib.mkDefault "main";
          push.autoSetupRemote = lib.mkDefault true;
        };
      };

      programs.direnv = {
        enable = true;
        enableBashIntegration = true;
        enableZshIntegration = true;
        nix-direnv.enable = true;
      };
    };
}
