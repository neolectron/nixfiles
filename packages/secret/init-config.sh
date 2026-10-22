# Bootstrap metadata only; never replace an existing config or contact a vault.
set -euo pipefail
home_directory="$1"
config_directory="$home_directory/.config/secret"
config_file="$config_directory/config.json"
if [[ ! -e "$config_file" && ! -L "$config_file" ]]; then
  umask 077
  mkdir -p -- "$config_directory"
  # noclobber also protects a file created concurrently after the check above.
  (set -C; printf '{"secrets":{}}\n' > "$config_file")
fi
