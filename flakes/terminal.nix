{ config, ... }:
let
  username = config.flake.username;
in
{
  flake.modules.nixos.terminal =
    { pkgs, ... }:
    {
      environment.systemPackages = with pkgs; [
        comma
        ghostty
      ];

      # Make zsh the default shell system-wide
      programs.zsh.enable = true;

      # Set zsh as the user's login shell
      users.users.${username}.shell = pkgs.zsh;
    };

  # Home Manager side: terminal emulators, shells, and prompt
  flake.modules.homeManager.terminal =
    { lib, ... }:
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

          # Status bar at the bottom
          set -g status-position bottom
          set -g status-style bg=default,fg=white
          set -g window-status-current-style bg=blue,fg=black,bold
        '';
      };

      programs.zsh = {
        enable = true;
        enableCompletion = lib.mkDefault true;
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
        # Auto-start tmux in interactive shells (but not if already in tmux or in VS Code)
        initContent = ''
          # Auto-start tmux if interactive and not already in tmux
          if [[ -o interactive ]] && [[ -z "$TMUX" ]] && [[ "$TERM_PROGRAM" != "vscode" ]]; then
            tmux attach -t main 2>/dev/null || tmux new -s main
          fi
        '';
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
