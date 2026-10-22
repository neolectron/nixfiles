# Lazy metadata-only alias completion; no vault access or shell-startup work.
_secret_complete() {
  local current="${COMP_WORDS[COMP_CWORD]}"
  local candidates
  if (( COMP_CWORD == 1 )); then
    candidates='status unlock lock list search get set edit id totp source pull pin rotate rm unset mv init env run print global prune lint doctor recent history'
  else
    candidates="$(command secret list 2>/dev/null | cut -f1)"
  fi
  mapfile -t COMPREPLY < <(compgen -W "$candidates" -- "$current")
}
complete -o default -F _secret_complete secret
