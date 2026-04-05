{ ... }:
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
    {
      home.packages = with pkgs; [
        vscode
        opencode
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
      ];

      programs.git = {
        enable = true;
        userName = "neolectron";
        userEmail = ""; # TODO: set your email
        extraConfig = {
          init.defaultBranch = "main";
          push.autoSetupRemote = true;
        };
      };

      programs.direnv = {
        enable = true;
        nix-direnv.enable = true;
      };
    };
}
