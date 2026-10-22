# Bash/zsh integration: bare unlock captures the token instead of printing it.
# --store is explicit and persists a session for noninteractive clients like DSH.
secret() {
  if [ "${1:-}" = unlock ]; then
    case " $* " in
      *' --help '*|*' -h '*) command secret "$@"; return $? ;;
      *' --store '*)
        command secret "$@" || return $?
        # A fresh stored session replaces any older shell-only token.
        unset BW_SESSION
        return 0
        ;;
    esac
    local token
    token="$(command secret "$@")" || return $?
    if [ -z "$token" ]; then
      printf '%s\n' 'secret: unlock produced no session token' >&2
      return 1
    fi
    export BW_SESSION="$token"
    printf '%s\n' 'secret: unlocked for this shell'
  elif [ "${1:-}" = lock ]; then
    unset BW_SESSION
    command secret "$@"
  else
    command secret "$@"
  fi
}
