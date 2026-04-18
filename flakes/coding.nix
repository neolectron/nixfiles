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
        vscode
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
