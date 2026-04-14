{ config, ... }:
{
  config.flake.modules.homeManager.bitwarden =
    { pkgs, ... }:
    {
      home.packages = [
        pkgs.bitwarden-desktop
      ];

      home.sessionVariables = {
        SSH_AUTH_SOCK = "/home/${config.flake.username}/.bitwarden-ssh-agent.sock";
      };
    };
}
