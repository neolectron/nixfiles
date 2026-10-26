{
  dataDirectory,
  dshHome,
  nodeExecutable,
  tunnelClient,
}:
let
  privateDirectory = "${dataDirectory}/private";
  gatewayEntry = "${dataDirectory}/current/dist/main.js";
  commonService = {
    Type = "simple";
    Restart = "on-failure";
    RestartSec = "5s";
    TimeoutStopSec = "30s";
    UMask = "0077";
    NoNewPrivileges = true;
    PrivateTmp = true;
    ProtectSystem = "strict";
    ProtectHome = "read-only";
    ReadWritePaths = [ privateDirectory ];
    RestrictSUIDSGID = true;
    LockPersonality = true;
    RestrictAddressFamilies = [ "AF_UNIX AF_INET AF_INET6" ];
    WorkingDirectory = dataDirectory;
  };
in
{
  dsh-mcp-gateway = {
    Unit = {
      Description = "Scoped local DSH MCP gateway";
      After = [ "network.target" ];
      ConditionPathExists = [
        nodeExecutable
        gatewayEntry
        "${privateDirectory}/config.json"
        "${privateDirectory}/gateway.env"
      ];
      StartLimitIntervalSec = 60;
      StartLimitBurst = 6;
    };
    Service = commonService // {
      ExecStart = "${nodeExecutable} ${gatewayEntry} --config ${privateDirectory}/config.json";
      Environment = [ "DSH_HOME=${dshHome}" ];
      EnvironmentFile = "${privateDirectory}/gateway.env";
    };
    Install.WantedBy = [ "default.target" ];
  };

  dsh-mcp-tunnel = {
    Unit = {
      Description = "Dedicated private OpenAI tunnel for DSH MCP";
      After = [ "dsh-mcp-gateway.service" ];
      Requires = [ "dsh-mcp-gateway.service" ];
      BindsTo = [ "dsh-mcp-gateway.service" ];
      ConditionPathExists = [
        "${privateDirectory}/tunnel.yaml"
        "${privateDirectory}/tunnel.env"
      ];
      StartLimitIntervalSec = 60;
      StartLimitBurst = 6;
    };
    Service = commonService // {
      ExecStart = "${tunnelClient}/bin/tunnel-client run --config ${privateDirectory}/tunnel.yaml --health.listen-addr 127.0.0.1:8791";
      EnvironmentFile = "${privateDirectory}/tunnel.env";
    };
    Install.WantedBy = [ "default.target" ];
  };
}
