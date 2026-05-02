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
    {
      home.packages = with pkgs; [
        # Utilities
        curl
        jq
        ripgrep
        fd
        htop
        btop
        uv
        gh
        nixfmt
        nixd
        # Editors
        vscode
        nodejs # needed by VSCode extensions (oxc, etc.)
        # Environment
        devenv
        # docker-compose
      ];

      programs.git = {
        enable = true;
        settings = {
          user.name = lib.mkDefault config.home.username;
          user.email = lib.mkDefault "jhon-doe@users.noreply.github.com";

          fetch.prune = lib.mkDefault true;
          init.defaultBranch = lib.mkDefault "main";

          rerere.enabled = lib.mkDefault true;
          merge.conflictstyle = lib.mkDefault "zdiff3";

          pull.rebase = lib.mkDefault true;
          pull.ff = lib.mkDefault "only";

          push.default = lib.mkDefault "simple";
          push.autoSetupRemote = lib.mkDefault true;

          rebase.autoStash = lib.mkDefault true;

          core.editor = lib.mkDefault "nvim";
          help.autocorrect = lib.mkDefault "prompt";
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
