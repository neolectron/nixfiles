{ config, ... }:
let
  username = config.flake.username;
  repository = "/home/${username}/dev/nixfiles";
in
{
  flake.modules.nixos.frostbitRebuildAuthorization =
    { lib, pkgs, ... }:
    let
      rebuildHelper = pkgs.writeShellApplication {
        name = "nixfiles-rebuild-root";
        runtimeInputs = [
          pkgs.coreutils
          pkgs.gitMinimal
        ];
        text = ''
          expected_uid="$(id -u ${lib.escapeShellArg username})"
          if [[ "''${PKEXEC_UID:-}" != "$expected_uid" ]]; then
            echo "This helper may only be started by ${username} through pkexec." >&2
            exit 1
          fi

          if (( $# != 1 )); then
            echo "Usage: nixfiles-rebuild-root <dry-activate|switch>" >&2
            exit 2
          fi

          case "$1" in
            dry-activate|switch) ;;
            *)
              echo "Only dry-activate and switch are supported." >&2
              exit 2
              ;;
          esac

          export PATH="$PATH:/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin"
          exec /run/current-system/sw/bin/nixos-rebuild "$1" \
            --flake ${lib.escapeShellArg "path:${repository}#frostbit"}
        '';
      };

      rebuildPolicy = pkgs.writeTextDir "share/polkit-1/actions/org.neolectron.nixfiles.rebuild.policy" ''
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE policyconfig PUBLIC
          "-//freedesktop//DTD PolicyKit Policy Configuration 1.0//EN"
          "https://www.freedesktop.org/standards/PolicyKit/1/policyconfig.dtd">
        <policyconfig>
          <vendor>nixfiles</vendor>
          <action id="org.neolectron.nixfiles.rebuild">
            <description>Apply the frostbit NixOS configuration</description>
            <message>Authentication is required to update frostbit</message>
            <defaults>
              <allow_any>no</allow_any>
              <allow_inactive>no</allow_inactive>
              <allow_active>auth_admin_keep</allow_active>
            </defaults>
            <annotate key="org.freedesktop.policykit.exec.path">${lib.getExe rebuildHelper}</annotate>
          </action>
        </policyconfig>
      '';
    in
    {
      environment.systemPackages = [
        rebuildHelper
        rebuildPolicy
      ];

      security.polkit = {
        enable = true;
        settings.Polkitd.ExpirationSeconds = 300;
      };
    };
}
