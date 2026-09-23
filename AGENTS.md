# nixfiles

NixOS configuration using **flake-parts** + **import-tree**.
Every `.nix` file under `flakes/` and `hosts/` is auto-imported as a flake-parts module.
Desktop runs the **niri** Wayland compositor with the **Noctalia** shell.

## Architecture

`flakes` are reusable — another person could import these on their own host.
`hosts` is user-machine-specific.
**Never put hardware values** (monitors, disk UUIDs, device workarounds) in `flakes`.
Each host lives in `hosts/<hostname>/`:

- `default.nix` — entrypoint: sets username, assembles `nixosConfigurations` from flakes + inline config.
- `hardware-configuration.nix` — hardware-specific module (filesystems, kernel modules, UUIDs).
- `config/` — optional folder, can be anything really, for splitting host config into multiple files.
  Host `default.nix` uses any flakes from `flakes/` and overrides config values.

## Commands

```bash
# Dry run — build but don't activate
scripts/nixos-rebuild-gui dry-activate --flake .#frostbit

# Apply only after the dry run passes
scripts/nixos-rebuild-gui switch --flake .#frostbit

# Evaluate without building (catches Nix-level errors fast)
nix flake check

# Update all flake inputs / a single input
nix flake update
nix flake update <input-name>
```

## Install and update workflow

For every package install, package update, flake-input update, or NixOS/Home
Manager configuration change:

Load and follow `.codex/skills/nixfiles-maintenance/SKILL.md`; the abbreviated
requirements below are mandatory for every agent.

1. Run `nix flake check`.
2. This repository uses NixOS-integrated Home Manager and has no standalone
   `homeConfigurations` output. Never run `home-manager switch`. Build and
   activate the integrated user's activation package instead:

   ```bash
   temporary_directory="$(mktemp -d /tmp/nixfiles-home-activation.XXXXXX)"
   temporary_link="$temporary_directory/result"
   nix build --out-link "$temporary_link" \
     .#nixosConfigurations.frostbit.config.home-manager.users.neolectron.home.activationPackage
   "$temporary_link/activate"
   unlink "$temporary_link"
   rmdir "$temporary_directory"
   ```

3. Run `scripts/nixos-rebuild-gui dry-activate --flake .#frostbit` and inspect
   the result. The helper opens the desktop authorization dialog, so the user
   enters the password in the GUI rather than an agent terminal.
4. Only after the dry activation succeeds, run
   `scripts/nixos-rebuild-gui switch --flake .#frostbit`.
5. Never pass `--sudo`, type a password, ask the user to send a password, or
   pipe credentials through stdin. Do not call `pkexec` directly: its sanitized
   environment omits tools needed by some Nix evaluations; the helper supplies
   the required system and per-user tool paths.

If an agent cannot display the authorization dialog, it must leave the switch
unapplied and give the user the exact helper command. It must not fall back to
an embedded password prompt.

## Commit Messages

Commit subjects created for this repository, whether by a person or an agent,
must use Conventional Commits:
`<type>[optional scope][!]: <imperative description>`.

Use a lowercase, specific type such as `feat`, `fix`, `docs`, `refactor`,
`test`, `build`, `ci`, `chore`, or `perf`. Avoid vague subjects such as
`WIP`, `update`, or `changes`.

## MCP Tools

- **nixos** — use to look up NixOS/Home Manager option types and defaults before setting them.
- **arch-linux** — only `search_archwiki` works here. Package install, system diagnostics, and
  other Arch-specific features will fail on NixOS. Use the wiki for Linux concepts and drivers.

## Flakes Rules

### `lib.mkDefault` discipline

Use on **leaf values** (gaps, cursor size, font, keybinds) so hosts can override individual
values without losing the rest. Never wrap parent attrsets — `mkDefault` applies to the whole
value, so overriding one key forces the host to redefine them all.

```nix
# Right — each value independently overridable
layout.gaps = lib.mkDefault 8;
layout.border.width = lib.mkDefault 2;

# Wrong — overriding `gaps` forces host to also redefine `border.width`
layout = lib.mkDefault { gaps = 8; border.width = 2; };
```

Host authors override a default with a plain assignment (priority 100 beats mkDefault's 1000):
`layout.gaps = 16;`

### The three config scopes cannot see each other

Flake-parts `config`, NixOS `config`, and Home Manager `config` are separate.
A NixOS module cannot read HM values. HM _can_ read NixOS config via `osConfig`,
but this repo bridges scopes through `./flakes/flake-options.nix` instead.
flake-options defines the options used in each host's `default.nix` and readable from any scope.

### Other

- Never hardcode home directories — derive from `"/home/${username}"`.

<!-- papercuts:start -->

## Papercuts

At the start of every task, run `papercuts list --format md`. When recurring or
concrete, fixable process/tooling friction requires a workaround, record it
before continuing:

    papercuts add --where <target> --fix "<next action>" [--ttl 24h|30d|365d] "<observed evidence>"

Do not log one-off mistakes, known baseline failures, or ownerless external
limitations. After fixing the issue or promoting it to a real task, run
`papercuts close <id-prefix>`.

<!-- papercuts:end -->
