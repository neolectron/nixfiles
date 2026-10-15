# Stream Deck session service

`flakes/streamdeck.nix` provides `hm.streamdeck`, enabled by frostbit. The
`streamdeck-studio` user service starts when `graphical-session.target` starts,
after niri has imported the Wayland and session environment. It stops with that
session. This is automatic startup **after graphical login**, not before login.
No lingering, root daemon, firewall opening or new group is configured.

The service keeps the existing loopback listener at `127.0.0.1:3900`, with the
editor, `/api/` and `/mcp` sharing one server. It runs without Node watch or Vite
development watchers. The packaged frontend is compiled during the Nix build;
backend TypeScript still runs directly through `node --import tsx`. Nix patches
the native addons and supplies the HID libraries and session command tools.

The user service can reach PipeWire/PulseAudio, MPRIS, Wayland, and the user's OBS
WebSocket configuration. OBS does not have to be open when Studio starts. USB
reconnection is retried by the existing connection controller; process failures
are restarted by systemd after three seconds. A manual `systemctl --user stop`
stays stopped until started again or the next graphical session.

## State and USB access

The service stores the existing profile and sidecar files in
`$XDG_STATE_HOME/streamdeck-studio` (normally
`~/.local/state/streamdeck-studio`). systemd creates this directory with mode
`0700`; files use a private umask. The profile, counters, notes, plugin settings
and credentials remain mutable user data, excluded from the Nix store and Git.

For the initial migration, copy **all** files from the previous ignored
`packages/streamdeck/.studio/` directory into the new directory while both
servers are stopped. Do not overwrite an existing destination. Verify file
hashes and retain the source as a backup. Later development must use the same
`--profile` deliberately or use a separate test profile; stop the service before
running another hardware owner.

The service requires read/write access to the deck's hidraw device. A visible
USB device alone does not prove it can be opened. An active-session `uaccess`
rule can provide access scoped to the confirmed device model; this integration
does not grant that permission itself. If missing, obtain approval for the exact
host-specific rule before changing permissions. Do not use a root service,
world-writable hidraw nodes or blanket input-device rules as a workaround.

## Build and targeted activation

```bash
pnpm check
nix flake check
nix build .#streamdeck-studio

activation_directory="$(mktemp -d /tmp/nixfiles-streamdeck.XXXXXX)"
nix build --out-link "$activation_directory/home" \
  .#nixosConfigurations.frostbit.config.home-manager.users.neolectron.home.activationPackage
unit="$(readlink -f "$activation_directory/home/home-files/.config/systemd/user/streamdeck-studio.service")"

# Review the exact unit and compare the Home Manager generation before activation.
cat "$unit"
systemd-analyze --user verify "$unit"

# Preserve the unit/package closure until a full Home Manager activation owns it.
state_directory="${XDG_STATE_HOME:-$HOME/.local/state}/streamdeck-studio"
mkdir -p "$state_directory"
chmod 700 "$state_directory"
nix-store --add-root "$state_directory/service-root" --indirect --realise "$(dirname "$unit")"
systemctl --user enable --now "$unit"
```

This installs only the generated service and its graphical-session dependency.
It does not run the complete Home Manager activation or a NixOS switch. During a
later update, compare the installed service first, replace its two symlinks with
the new generated unit, update the GC root, then reload and restart the user
service. Never overwrite a manually edited unit silently. Once the regular
integrated Home Manager activation manages the unit, its generation keeps the
closure alive and the temporary `service-root` GC root can be removed.

For normal full-system application, use the GUI-authorized rebuild workflow in
`AGENTS.md` only when that broader activation is authorized. The installed helper
always evaluates the principal checkout, not an isolated development clone.

```bash
systemctl --user status streamdeck-studio
systemctl --user is-enabled streamdeck-studio
journalctl --user -u streamdeck-studio --since '5 minutes ago'
curl --fail http://127.0.0.1:3900/api/state
```

Verify `connected: true`, the expected profile and counter values, one process
with the deck open, and only a loopback listener. Check normal restart and
recovery after a process failure. An enabled service or a healthy HTTP response
alone does not prove USB ownership. The Nix package's install check also renders
a React preview outside the checkout to catch missing JSX configuration,
fonts, or native runtime libraries.
