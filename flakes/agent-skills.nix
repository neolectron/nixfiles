{ ... }:
let
  skillNames = [
    "antislop"
    "grill-me"
    "jj"
    "papercuts"
    "reference-repository"
    "rtk"
    "show-me"
    "taste-from-sessions"
    "write-a-skill"
  ];
in
{
  flake.modules.homeManager.agentSkills =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      skillSource = ../assets/agent-skills;

      deploySkills =
        targetDirectory:
        builtins.listToAttrs (
          map (name: {
            name = "${targetDirectory}/${name}";
            value = {
              source = "${skillSource}/${name}";
              recursive = true;
            };
          }) skillNames
        );

      mkTracker =
        {
          command,
          recordName,
          globalFile,
          terminalCommand,
        }:
        pkgs.writeShellApplication {
          name = command;
          runtimeInputs = [ pkgs.jq ];
          text = ''
            set -euo pipefail

            usage() {
              cat <<'EOF'
            ${command} add [--global] <text> [--tag <tag>] [--severity minor|major|blocker]
            ${command} list [--global] [--format json|md] [--all]
            ${command} resolve [--global] <id-prefix>
            ${command} ${terminalCommand} [--global] <id-prefix> <reason>
            ${command} clean [--global]
            ${command} schema
            EOF
            }

            command_name="${command}"
            action="''${1:-help}"
            if [[ $# -gt 0 ]]; then shift; fi
            global=false
            if [[ "''${1:-}" == "--global" ]]; then
              global=true
              shift
            fi

            file=".${recordName}.jsonl"
            if [[ "$global" == true ]]; then
              file="$HOME/${globalFile}"
            fi

            require_file() {
              if [[ ! -f "$file" ]]; then
                printf '%s: no records in %s\n' "$command_name" "$file" >&2
                exit 1
              fi
            }

            add() {
              local text="''${1:?$command_name add requires text}"
              shift
              local tag="other"
              local severity="minor"
              local pattern=""
              local prescription=""
              while [[ $# -gt 0 ]]; do
                case "$1" in
                  --tag) tag="''${2:?--tag requires a value}"; shift 2 ;;
                  --severity) severity="''${2:?--severity requires a value}"; shift 2 ;;
                  --pattern) pattern="''${2:?--pattern requires a value}"; shift 2 ;;
                  --prescription) prescription="''${2:?--prescription requires a value}"; shift 2 ;;
                  *) printf '%s: unknown option %s\n' "$command_name" "$1" >&2; exit 2 ;;
                esac
              done
              case "$severity" in minor|major|blocker) ;; *) echo "invalid severity: $severity" >&2; exit 2 ;; esac
              mkdir -p "$(dirname "$file")"
              jq -cn \
                --arg id "$(date +%s)-$RANDOM" \
                --arg kind "${recordName}" \
                --arg text "$text" \
                --arg tag "$tag" \
                --arg severity "$severity" \
                --arg pattern "$pattern" \
                --arg prescription "$prescription" \
                --arg now "$(date --iso-8601=seconds)" \
                '{ id: $id, kind: $kind, text: $text, tag: $tag, severity: $severity, pattern: $pattern, prescription: $prescription, state: "open", createdAt: $now }' \
                >> "$file"
              printf '%s added to %s\n' "$command_name" "$file"
            }

            list() {
              local format="json"
              local include_all=false
              while [[ $# -gt 0 ]]; do
                case "$1" in
                  --format) format="''${2:?--format requires json or md}"; shift 2 ;;
                  --all) include_all=true; shift ;;
                  *) printf '%s: unknown option %s\n' "$command_name" "$1" >&2; exit 2 ;;
                esac
              done
              [[ -f "$file" ]] || exit 0
              local filter='select(.state == "open")'
              [[ "$include_all" == true ]] && filter='.'
              case "$format" in
                json) jq -c "$filter" "$file" ;;
                md) jq -r "$filter | \"- [\\(.severity)] \\(.text) — \\(.tag) (\\(.id), \\(.state))\"" "$file" ;;
                *) echo "invalid format: $format" >&2; exit 2 ;;
              esac
            }

            transition() {
              local state="$1"
              local prefix="''${2:?$command_name $state requires an id prefix}"
              local reason="''${3:-}"
              require_file
              local matches
              matches="$(jq -rs --arg prefix "$prefix" '[.[] | select(.id | startswith($prefix))] | length' "$file")"
              if [[ "$matches" != 1 ]]; then
                printf '%s: expected one record for %s; found %s\n' "$command_name" "$prefix" "$matches" >&2
                exit 1
              fi
              local tmp
              tmp="$(mktemp "$(dirname "$file")/.${recordName}.XXXXXX")"
              jq -c --arg prefix "$prefix" --arg state "$state" --arg reason "$reason" \
                'if (.id | startswith($prefix)) then .state = $state | .reason = $reason else . end' \
                "$file" > "$tmp"
              mv "$tmp" "$file"
            }

            case "$action" in
              add) add "$@" ;;
              list) list "$@" ;;
              resolve) transition "resolved" "''${1:-}" ;;
              ${terminalCommand}) transition "${terminalCommand}" "''${1:-}" "''${2:-}" ;;
              clean)
                if [[ -f "$file" ]]; then
                  jq -c . "$file" > "$file.tmp"
                  mv "$file.tmp" "$file"
                fi
                ;;
              schema) echo '{"id":"string","kind":"string","text":"string","tag":"string","severity":"minor|major|blocker","state":"open|resolved|${terminalCommand}"}' ;;
              help|--help|-h) usage ;;
              *) usage >&2; exit 2 ;;
            esac
          '';
        };

      antislop = mkTracker {
        command = "antislop";
        recordName = "antislop";
        globalFile = ".antislop.jsonl";
        terminalCommand = "supersede";
      };

      papercuts = mkTracker {
        command = "papercuts";
        recordName = "papercuts";
        globalFile = ".papercuts.jsonl";
        terminalCommand = "unresolvable";
      };
    in
    {
      home.packages = [
        pkgs.rtk
        pkgs.jujutsu
        antislop
        papercuts
      ];

      # ~/.agents is the canonical shared tree. Each supported harness receives
      # symlinks to the same Nix-managed sources without replacing its other skills.
      home.file =
        deploySkills ".agents/skills"
        // deploySkills ".codex/skills"
        // deploySkills ".config/opencode/skills"
        // {
          ".copilot/skills".source =
            config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.agents/skills";
        };
    };
}
