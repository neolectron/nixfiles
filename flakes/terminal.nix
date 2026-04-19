{ config, ... }:
let
  username = config.flake.username;
in
{
  flake.modules.nixos.terminal =
    { pkgs, ... }:
    {
      environment.systemPackages = with pkgs; [
        ghostty
      ];

      # Make zsh the default shell system-wide
      programs.zsh.enable = true;

      # Set zsh as the user's login shell
      users.users.${username}.shell = pkgs.zsh;
    };

  # Home Manager side: terminal emulators, shells, and prompt
  flake.modules.homeManager.terminal =
    { pkgs, lib, ... }:
    {
      programs.tmux = {
        enable = true;
        shortcut = lib.mkDefault "t";
        baseIndex = lib.mkDefault 1;
        keyMode = lib.mkDefault "vi";
        mouse = lib.mkDefault true;
        newSession = lib.mkDefault true;
        historyLimit = lib.mkDefault 50000;
        escapeTime = lib.mkDefault 0;
        extraConfig = lib.mkDefault ''
          # Automatically renumber windows when one is closed
          set -g renumber-windows on

          # Destroy session when the terminal is closed or detached
          set -g destroy-unattached on

          # Status bar at the bottom
          set -g status-position bottom
          set -g status-style bg=default,fg=white
          set -g window-status-current-style bg=blue,fg=black,bold
        '';
      };

      programs.zsh = {
        enable = true;
        # Keep completion stack minimal: native zsh completion + carapace bridge.
        enableCompletion = true;
        autosuggestion.enable = lib.mkDefault true;
        syntaxHighlighting.enable = lib.mkDefault true;
        history = {
          size = lib.mkDefault 10000;
          save = lib.mkDefault 10000;
          share = lib.mkDefault true;
          append = lib.mkDefault true;
          ignoreDups = lib.mkDefault true;
        };
        shellAliases = lib.mkDefault {
          ll = "ls -la";
          la = "ls -a";
        };
        plugins = [ ];
        # Auto-start tmux — exec replaces the shell so "exit" closes the terminal
        initContent = lib.mkOrder 1500 ''
          if [[ -o interactive ]] && [[ -z "$TMUX" ]] && [[ "$TERM_PROGRAM" != "vscode" ]]; then
            exec tmux new-session
          fi
        '';
      };

      # fzf — fuzzy finder with shell integration
      programs.fzf = {
        enable = true;
        enableZshIntegration = lib.mkDefault true;
      };


      programs.fastfetch = {
        enable = lib.mkDefault true;
        settings = lib.mkDefault {
          logo = {
            source = "nixos_small";
            padding.right = 2;
          };
          modules = [
            "title"
            "separator"
            "os"
            "host"
            "kernel"
            "uptime"
            "packages"
            "shell"
            "terminal"
            "cpu"
            "gpu"
            "memory"
            "break"
            "colors"
          ];
        };
      };

      programs.starship = {
        enable = true;
        enableZshIntegration = lib.mkDefault true;
        settings = lib.mkDefault {
          character = {
            success_symbol = "[➜](bold green)";
            error_symbol = "[✗](bold red)";
          };
          directory = {
            truncation_length = 3;
            truncate_to_repo = true;
          };
        };
      };

      programs.zoxide = {
        enable = true;
        enableZshIntegration = lib.mkDefault true;
        options = lib.mkDefault [ "--cmd cd" ];
      };
    };
}
