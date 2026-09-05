{ inputs, ... }:
{
  flake.checks.x86_64-linux.update-pins =
    let
      pkgs = inputs.nixpkgs.legacyPackages.x86_64-linux;
    in
    pkgs.runCommand "update-pins-check"
      {
        nativeBuildInputs = [
          pkgs.bun
          pkgs.gnugrep
          pkgs.nix
        ];
      }
      ''
        export UPDATE_PINS_REPO_ROOT="$TMPDIR/repo"
        export HOME="$TMPDIR/home"
        export NIX_CONFIG="experimental-features = nix-command flakes"
        mkdir -p "$HOME"
        mkdir -p "$UPDATE_PINS_REPO_ROOT/scripts"
        cp ${../scripts/update-pins.ts} "$UPDATE_PINS_REPO_ROOT/scripts/update-pins.ts"
        cp ${../scripts/update-pins.json} "$UPDATE_PINS_REPO_ROOT/scripts/update-pins.json"

        bun "$UPDATE_PINS_REPO_ROOT/scripts/update-pins.ts" --list \
          | grep --fixed-strings 'codeburn'

        set +e
        bun "$UPDATE_PINS_REPO_ROOT/scripts/update-pins.ts" \
          --dry-run --only unknown-entry \
          >"$TMPDIR/unknown.stdout" 2>"$TMPDIR/unknown.stderr"
        unknown_status=$?
        set -e
        if [ "$unknown_status" -eq 0 ]; then
          echo "unknown update entry unexpectedly succeeded" >&2
          exit 1
        fi

        set +e
        bun "$UPDATE_PINS_REPO_ROOT/scripts/update-pins.ts" \
          --dry-run --only codeburn --skip codeburn --validate fast \
          >"$TMPDIR/no-op.stdout" 2>"$TMPDIR/no-op.stderr"
        no_op_status=$?
        set -e
        if [ "$no_op_status" -eq 0 ]; then
          echo "no-op update selection unexpectedly succeeded" >&2
          exit 1
        fi
        grep --fixed-strings 'validation was not run' "$TMPDIR/no-op.stderr"

        touch "$out"
      '';
}
