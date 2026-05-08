{ inputs, config, ... }:
let
  username = config.flake.username;
in
{
  # NixOS side: enable zsh system-wide, set user shell, install ghostty
  flake.modules.nixos.terminal =
    { pkgs, ... }:
    {
      nixpkgs.overlays = [
        (final: prev: {
          _0fetch = inputs._0fetch.packages.${final.system}.default;
        })
      ];

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
      home.packages = with pkgs; [
        _0fetch
      ];

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
      # Run 0fetch in every interactive shell, then auto-start tmux
      initContent = lib.mkOrder 1500 ''
        if [[ -o interactive ]]; then
          ${pkgs.lib.getExe pkgs._0fetch}
        fi
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

      # Ghostty: glassy transparency with blur for Noctalia integration.
      # - background-opacity: 0.9 gives subtle transparency (1.0 = fully opaque)
      # - background-blur: 10 creates frosted glass effect (1-20, 0 = off)
      programs.ghostty = {
        enable = true;
        settings = lib.mkDefault {
          mouse-scroll-multiplier = "precision:0,discrete:3";
          confirm-close-surface = "false";
          background-opacity = "0.9";
          background-blur = "10";
        };
      };

      # Create a desktop entry for "terminal-as-file-manager"
      # This replaces qdirstat as the handler for inode/directory
      xdg.desktopEntries.terminal-file-manager = {
        name = "Terminal (as File Manager)";
        comment = "Open directory in terminal";
        exec = "${lib.getExe pkgs.ghostty} --working-directory=%f";
        terminal = false;
        type = "Application";
        mimeType = [ "inode/directory" "inode/mount-point" ];
        categories = [ "System" "FileTools" "FileManager" ];
        icon = "utilities-terminal";
        noDisplay = true;
      };

      # Set the terminal desktop entry as the default file manager
      xdg.mimeApps = {
        enable = true;
        associations.added = {
          "inode/directory" = [ "terminal-file-manager.desktop" ];
          "inode/mount-point" = [ "terminal-file-manager.desktop" ];
        };
        defaultApplications = {
          "inode/directory" = [ "terminal-file-manager.desktop" ];
          "inode/mount-point" = [ "terminal-file-manager.desktop" ];
        };
      };
    };
}
