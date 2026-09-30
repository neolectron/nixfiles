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

      # The Linux Computer Use backend reads accessibility trees over AT-SPI,
      # moves the pointer through uinput, and uses ydotool for keyboard input
      # when Niri has no RemoteDesktop keyboard portal.
      assertions = [
        {
          assertion = lib.versionAtLeast pkgs.ydotool.version "1.0.3";
          message = "Codex Linux Computer Use requires ydotool 1.0.3 or newer.";
        }
      ];
      services.gnome.at-spi2-core.enable = true;
      hardware.uinput.enable = true;
      programs.ydotool.enable = true;
      environment.sessionVariables.YDOTOOL_SOCKET = lib.mkDefault "/run/ydotoold/socket";
      users.users.${username}.extraGroups = [
        "uinput"
        "ydotool"
      ];
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
      codexPackage = pkgs.callPackage ../packages/codex/default.nix { };
      codexExec = lib.getExe codexPackage;
      opencodeAuthPath = "${config.home.homeDirectory}/.local/share/opencode/auth.json";
      codexOpenCodeGoEnv = pkgs.writeShellScript "codex-opencode-go-env" ''
        if [ -r "${opencodeAuthPath}" ]; then
          if opencode_api_key="$(${lib.getExe pkgs.jq} -er '."opencode-go".key // empty' "${opencodeAuthPath}" 2>/dev/null)"; then
            export OPENCODE_API_KEY="$opencode_api_key"
          fi
        fi
      '';

      codexWrapper = pkgs.writeShellScriptBin "codex" ''
        set -euo pipefail

        . ${codexOpenCodeGoEnv}

        exec ${codexExec} "$@"
      '';

      # The desktop resolves codex-code-mode-host as a sibling of CODEX_CLI_PATH.
      # Merge the wrapper with the underlying package so both binaries share a bin/.
      codex = pkgs.lib.hiPrio (
        pkgs.symlinkJoin {
          name = "codex";
          paths = [
            codexWrapper
            codexPackage
          ];
        }
      );

      codexDesktopComputerUsePackage =
        inputs.codex-desktop-linux.packages.${pkgs.stdenv.hostPlatform.system}.codex-desktop-computer-use-ui;
      codexComputerUseLinux = pkgs.writeShellScriptBin "codex-computer-use-linux" ''
        export YDOTOOL_SOCKET="''${YDOTOOL_SOCKET:-/run/ydotoold/socket}"
        for plugin in unified-computer-use computer-use; do
          backend="${codexDesktopComputerUsePackage}/opt/codex-desktop/resources/plugins/openai-bundled/plugins/$plugin/bin/codex-computer-use-linux"
          if [ -x "$backend" ]; then
            exec "$backend" "$@"
          fi
        done
        echo "Codex Linux Computer Use backend is missing from the desktop package" >&2
        exit 1
      '';
    in
    {
      imports = [
        inputs.codex-desktop-linux.homeManagerModules.default
      ];

      programs.codexDesktopLinux = {
        enable = true;
        computerUseUi.enable = true;
        cliPackage = codex;
      };

      dconf.settings."org/gnome/desktop/interface".toolkit-accessibility = true;

      home.packages = [
        codex
        codexComputerUseLinux
        opencodexPackage
        pkgs.jq
        pkgs.context7-mcp
        pkgs.github-mcp-server
      ]
      ++ lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.mcp-nixos ];

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
