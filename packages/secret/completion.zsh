# Lazy metadata-only alias completion; compinit is provided by Home Manager.
_secret_complete() {
  if (( CURRENT == 2 )); then
    compadd -- status unlock lock list search get set edit id totp source pull pin rotate rm unset mv init env run print global prune lint doctor recent history
  else
    local alias_name rest
    local -a aliases
    while IFS=$'\t' read -r alias_name rest; do
      [[ -n "$alias_name" ]] && aliases+=("$alias_name")
    done < <(command secret list 2>/dev/null)
    compadd -- "${aliases[@]}"
  fi
}
compdef _secret_complete secret
