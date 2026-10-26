{ inputs, config, ... }:
let
  pkgs = inputs.nixpkgs.legacyPackages.x86_64-linux;
  homeDirectory = "/home/${config.flake.username}";
  tunnelClient = pkgs.callPackage ../packages/tunnel-client/default.nix { };
in
{
  flake.packages.x86_64-linux.tunnel-client = tunnelClient;
  # Build/export these two artifacts without activating an entire HM generation.
  flake.packages.x86_64-linux.dsh-mcp-service-files =
    pkgs.callPackage ../packages/dsh-mcp-services/default.nix
      {
        inherit tunnelClient;
        dataDirectory = "${homeDirectory}/.local/share/dsh-mcp-gateway";
        dshHome = "${homeDirectory}/.dsh";
        nodeExecutable = "${homeDirectory}/.local/share/fnm/node-versions/v22.23.3/installation/bin/node";
      };

  flake.modules.homeManager.dshMcpGateway =
    { config, lib, ... }:
    let
      cfg = config.services.dshMcpGateway;
    in
    {
      options.services.dshMcpGateway = {
        enable = lib.mkEnableOption "the scoped DSH MCP gateway and dedicated private tunnel";
        dataDirectory = lib.mkOption {
          type = lib.types.str;
          default = "${config.xdg.dataHome}/dsh-mcp-gateway";
          description = "Operator-managed release and private runtime configuration directory.";
        };
        dshHome = lib.mkOption {
          type = lib.types.str;
          default = "${config.home.homeDirectory}/.dsh";
          description = "Existing DSH home; launch credentials remain in its protected SDK record.";
        };
        nodeExecutable = lib.mkOption {
          type = lib.types.str;
          default = "${config.home.homeDirectory}/.local/share/fnm/node-versions/v22.23.3/installation/bin/node";
          description = "Official Node 22 executable, never the Nix Node build.";
        };
      };
      config = lib.mkIf cfg.enable {
        systemd.user.services = import ../packages/dsh-mcp-services/units.nix {
          inherit tunnelClient;
          inherit (cfg) dataDirectory dshHome nodeExecutable;
        };
      };
    };
}
