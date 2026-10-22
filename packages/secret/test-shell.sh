# Run with bash; every secret invocation goes to the synthetic fake below.
set -euo pipefail
bash_bin="$1"
zsh_bin="$2"
helper="$3"
bash_completion="$4"
zsh_completion="$5"
initializer="$6"
root="$(mktemp -d)"
trap 'rm -rf -- "${root:?}"' EXIT
mkdir -p "$root/bin"
"$bash_bin" "$initializer" "$root/bootstrap"
test "$(stat -c %a "$root/bootstrap/.config/secret/config.json")" = 600
test "$(< "$root/bootstrap/.config/secret/config.json")" = '{"secrets":{}}'
printf '%s\n' '{"secrets":{},"userMarker":"preserve"}' > "$root/bootstrap/.config/secret/config.json"
"$bash_bin" "$initializer" "$root/bootstrap"
test "$(< "$root/bootstrap/.config/secret/config.json")" = '{"secrets":{},"userMarker":"preserve"}'
printf '#!%s\n' "$bash_bin" > "$root/bin/secret"
cat >> "$root/bin/secret" <<'FAKE'
printf '%s\n' "$*" >> "$SECRET_TEST_LOG"
case " $* " in
  *' --help '*) printf '%s\n' 'Usage: secret unlock' ;;
  *' --store '*) printf '%s\n' 'stored without a token' ;;
  ' unlock ') printf '%s\n' 'synthetic-shell-session' ;;
  ' list ') printf 'fixture-alias\tfixture-item\tpassword\n' ;;
  ' lock ') : ;;
  *) exit 98 ;;
esac
FAKE
chmod +x "$root/bin/secret"
for shell in "$bash_bin" "$zsh_bin"; do
  env -i HOME="$root" PATH="$root/bin:$PATH" SECRET_TEST_HELPER="$helper" \
    SECRET_TEST_LOG="$root/log" SECRET_TEST_BIN="$root/bin" "$shell" -c '
      set -eu
      export PATH="$SECRET_TEST_BIN:$PATH"
      . "$SECRET_TEST_HELPER"
      test ! -e "$SECRET_TEST_LOG"
      export BW_SESSION=stale-session
      secret unlock --store > "$HOME/store-output"
      test -z "${BW_SESSION+x}"
      secret unlock > "$HOME/unlock-output"
      test "$BW_SESSION" = synthetic-shell-session
      test "$(< "$HOME/unlock-output")" = "secret: unlocked for this shell"
      secret unlock --help > "$HOME/help-output"
      test "$BW_SESSION" = synthetic-shell-session
      secret lock
      test -z "${BW_SESSION+x}"
    '
  # This is a known temporary fixture path, not a user file.
  test "$root/log" = "${root:?}/log"
  rm -- "$root/log"
done
"$bash_bin" -n "$helper" "$bash_completion"
"$zsh_bin" -n "$helper" "$zsh_completion"
env -i HOME="$root" PATH="$root/bin:$PATH" SECRET_TEST_LOG="$root/log" \
  SECRET_TEST_COMPLETION="$bash_completion" "$bash_bin" -c '
    set -eu
    . "$SECRET_TEST_COMPLETION"
    test ! -e "$SECRET_TEST_LOG"
    COMP_WORDS=(secret get fixture)
    COMP_CWORD=2
    _secret_complete
    test "${COMPREPLY[0]}" = fixture-alias
  '
test "$root/log" = "${root:?}/log"
rm -- "$root/log"
env -i HOME="$root" PATH="$root/bin:$PATH" SECRET_TEST_LOG="$root/log" \
  SECRET_TEST_COMPLETION="$zsh_completion" SECRET_TEST_BIN="$root/bin" "$zsh_bin" -f -c '
    set -eu
    export PATH="$SECRET_TEST_BIN:$PATH"
    compdef() { :; }
    compadd() { [[ "$2" == fixture-alias ]]; }
    . "$SECRET_TEST_COMPLETION"
    test ! -e "$SECRET_TEST_LOG"
    CURRENT=3
    _secret_complete
  '
printf '%s\n' 'Shell unlock/lock/help and lazy completion tests passed.'
