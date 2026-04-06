{ config, ... }:
{
  # NixOS side: nix-ld for VSCode remote extensions and other dynamically-linked tools
  flake.modules.nixos.coding =
    { ... }:
    {
      programs.nix-ld.enable = true;
    };

  # Home Manager side: development tools
  flake.modules.homeManager.coding =
    { pkgs, ... }:
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
        htop
        devenv
      ];

      # OpenCode headless server — always running, reachable at http://localhost:4096
      systemd.user.services.opencode-web = {
        Unit = {
          Description = "Shared OpenCode backend";
        };
        Service = {
          Type = "simple";
          ExecStart = "${opencode-bin} serve";
          Restart = "always";
          RestartSec = "2";
          WorkingDirectory = "%h";
        };
        Install = {
          WantedBy = [ "default.target" ];
        };
      };

      programs.git = {
        enable = true;
        settings = {
          user.name = config.flake.username;
          user.email = config.flake.userEmail;
          init.defaultBranch = "main";
          push.autoSetupRemote = true;
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
