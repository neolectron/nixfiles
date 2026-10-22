#!@bash@
# The noninteractive DSH Host reads the stored session without receiving a
# credential through settings, command arguments or its launch environment.
set -euo pipefail
export SECRET_DAEMON=0
export SECRET_NO_BIOMETRICS=1
export SECRET_NO_PROMPT=1
if [[ "${1:-}" != unlock && -z "${BW_SESSION:-}" ]]; then
  session_file="${SECRET_SESSION_FILE:-$HOME/.config/secret/session}"
  if [[ -e "$session_file" ]]; then
    if [[ ! -f "$session_file" || -L "$session_file" || ! -O "$session_file" ]]; then
      printf '%s\n' 'secret: stored session must be a regular file owned by this user' >&2
      exit 1
    fi
    mode="$(stat -c %a -- "$session_file")"
    if (( (8#$mode & 077) != 0 )); then
      printf '%s\n' 'secret: stored session must not be accessible to other users; use chmod 600' >&2
      exit 1
    fi
    BW_SESSION="$(< "$session_file")"
    export BW_SESSION
  fi
fi
exec @binary@ "$@"
