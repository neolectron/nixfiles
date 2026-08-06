{ inputs, config, ... }:
let
  username = config.flake.username;

  mkCodexSettings =
    { pkgs, lib }:
    let
      homeDirectory = "/home/${username}";
      context7TokenPath = "${homeDirectory}/.config/agent-mcp/context7-token";
      githubTokenPath = "${homeDirectory}/.config/agent-mcp/github-token";

      context7Mcp = pkgs.writeShellScript "codex-context7-mcp" ''
        set -eu
        token_file=${lib.escapeShellArg context7TokenPath}
        if [ ! -r "$token_file" ]; then
          printf 'Context7 MCP token is not readable: %s\n' "$token_file" >&2
          exit 1
        fi
        CONTEXT7_API_KEY="$(${pkgs.coreutils}/bin/cat "$token_file")"
        if [ -z "$CONTEXT7_API_KEY" ]; then
          printf 'Context7 MCP token is empty: %s\n' "$token_file" >&2
          exit 1
        fi
        export CONTEXT7_API_KEY
        exec ${lib.getExe pkgs.context7-mcp}
      '';

      githubMcp = pkgs.writeShellScript "codex-github-mcp" ''
        set -eu
        token_file=${lib.escapeShellArg githubTokenPath}
        if [ ! -r "$token_file" ]; then
          printf 'GitHub MCP token is not readable: %s\n' "$token_file" >&2
          exit 1
        fi
        GITHUB_PERSONAL_ACCESS_TOKEN="$(${pkgs.coreutils}/bin/cat "$token_file")"
        if [ -z "$GITHUB_PERSONAL_ACCESS_TOKEN" ]; then
          printf 'GitHub MCP token is empty: %s\n' "$token_file" >&2
          exit 1
        fi
        export GITHUB_PERSONAL_ACCESS_TOKEN
        exec ${lib.getExe pkgs.github-mcp-server} stdio
      '';
    in
    {
      model = "gpt-5.5";
      openai_base_url = "http://127.0.0.1:10100/v1";
      model_reasoning_effort = "high";
      model_reasoning_summary = "concise";
      model_verbosity = "low";
      personality = "pragmatic";

      model_providers."opencode-go" = {
        name = "OpenCode Go";
        base_url = "https://opencode.ai/zen/go/v1";
        env_key = "OPENCODE_API_KEY";
        env_key_instructions = "Export OPENCODE_API_KEY in your shell, or authenticate in OpenCode and add a bridge later.";
        wire_api = "responses";
        requires_openai_auth = false;
      };

      mcp_servers = {
        context7 = {
          command = "${context7Mcp}";
          enabled = true;
        };
        github = {
          command = "${githubMcp}";
          enabled = true;
        };
      }
      // lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
        nixos = {
          command = lib.getExe pkgs.mcp-nixos;
          enabled = true;
        };
      };
    };

  mkCodexConfig =
    { pkgs, lib }:
    (pkgs.formats.toml { }).generate "codex-config.toml" (mkCodexSettings {
      pkgs = pkgs;
      lib = lib;
    });
in
{
  flake.modules.nixos.codexDesktop =
    { pkgs, lib, ... }:
    {
      environment.etc."codex/config.toml".source = mkCodexConfig {
        pkgs = pkgs;
        lib = lib;
      };
    };

  flake.modules.homeManager.codexDesktop =
    {
      pkgs,
      lib,
      config,
      ...
    }:
    let
      opencodexPackage = pkgs.callPackage ../packages/opencodex/default.nix { };
      codexExec = lib.getExe pkgs.codex;
      opencodeAuthPath = "${config.home.homeDirectory}/.local/share/opencode/auth.json";
      codexOpenCodeGoEnv = pkgs.writeShellScript "codex-opencode-go-env" ''
        if [ -r "${opencodeAuthPath}" ]; then
          if opencode_api_key="$(${lib.getExe pkgs.jq} -er '."opencode-go".key // empty' "${opencodeAuthPath}" 2>/dev/null)"; then
            export OPENCODE_API_KEY="$opencode_api_key"
          fi
        fi
      '';

      codex = pkgs.lib.hiPrio (
        pkgs.writeShellScriptBin "codex" ''
          set -euo pipefail

          . ${codexOpenCodeGoEnv}

          exec ${codexExec} "$@"
        ''
      );
    in
    {
      imports = [
        inputs.codex-desktop-linux.homeManagerModules.default
      ];

      programs.codexDesktopLinux = {
        enable = true;
        cliPackage = codex;
      };

      home.packages = [
        codex
        opencodexPackage
        pkgs.jq
        pkgs.context7-mcp
        pkgs.github-mcp-server
      ] ++ lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.mcp-nixos ];

      home.file.".codex/.keep".text = "";
      home.file.".opencodex/.keep".text = "";

      systemd.user.services.opencodex = lib.mkIf pkgs.stdenv.hostPlatform.isLinux {
        Unit = {
          Description = "OpenCodex provider proxy";
          After = [ "network-online.target" ];
        };
        Service = {
          ExecStart = "${lib.getExe opencodexPackage} start --port 10100";
          Restart = "on-failure";
          RestartSec = "5";
          WorkingDirectory = config.home.homeDirectory;
        };
        Install.WantedBy = [ "default.target" ];
      };
    };
}
