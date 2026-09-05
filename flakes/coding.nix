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
        # btop-rocm is the amd one, btop-cuda is the nvidia one
        btop-rocm
        uv
        gh
        jujutsu
        nixfmt
        nixd
        # Editors
        (vscode.fhsWithPackages (vscodePackages: [ vscodePackages.stdenv.cc.cc.lib ]))
        nodejs # needed by VSCode extensions (oxc, etc.)
        # Environment
        devenv
        # docker-compose
      ];

      # Register vscode:// URI scheme so browsers/portal open VS Code auth redirects
      # instead of showing the useless "find in app store" dialog.
      xdg.mimeApps = {
        enable = true;
        defaultApplications = {
          "x-scheme-handler/vscode" = [ "code-url-handler.desktop" ];
        };
      };

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
