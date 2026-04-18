{ ... }:
{
  flake.modules.nixos.terminal =
    { pkgs, ... }:
    {
      environment.systemPackages = with pkgs; [
        comma
        ghostty
      ];
    };

  # Home Manager side: terminal emulators, shells, and prompt
  flake.modules.homeManager.terminal =
    { lib, ... }:
    {
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
