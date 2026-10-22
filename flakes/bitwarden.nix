{ inputs, ... }:
{
  flake.packages.x86_64-linux.secret =
    inputs.nixpkgs.legacyPackages.x86_64-linux.callPackage ../packages/secret
      { };
  flake.checks.x86_64-linux.secret =
    inputs.nixpkgs.legacyPackages.x86_64-linux.callPackage ../packages/secret
      { };

  flake.modules.homeManager.bitwarden =
    {
      config,
      pkgs,
      lib,
      ...
    }:
    let
      secret = pkgs.callPackage ../packages/secret { };
    in
    {
      home.packages = [
        pkgs.bitwarden-desktop
        pkgs.bitwarden-cli
        secret
      ];

      # The Catalog's global metadata read needs a config even on first use.
      # This creates an empty writable file only; existing configs are untouched.
      home.activation.secretConfig = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        run ${pkgs.bash}/bin/bash ${../packages/secret/init-config.sh} ${lib.escapeShellArg config.home.homeDirectory}
      '';

      # No activation step contacts the vault or replaces an SSH key.
      programs.bash.initExtra = lib.mkIf config.programs.bash.enable (
        lib.mkAfter ''
          source ${../packages/secret/shell.sh}
          source ${../packages/secret/completion.bash}
        ''
      );
      programs.zsh.initContent = lib.mkIf config.programs.zsh.enable (
        lib.mkAfter ''
          source ${../packages/secret/shell.sh}
          source ${../packages/secret/completion.zsh}
        ''
      );

      home.sessionVariables = {
        SSH_AUTH_SOCK = "${config.home.homeDirectory}/.bitwarden-ssh-agent.sock";
      };
    };
}
