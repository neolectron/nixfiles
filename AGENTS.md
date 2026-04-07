# nixfiles

NixOS configuration using **flake-parts** + **import-tree**.
Every `.nix` file under `modules/` and `hosts/` is auto-imported as a flake-parts module.
Desktop runs the **niri** Wayland compositor with the **Noctalia** shell.

## Architecture

`modules` are reusable — another person could import these on their own host.
`hosts` is user-machine-specific.
**Never put hardware values** (monitors, disk UUIDs, device workarounds) in `modules`.
Entrypoints per hosts: `hosts/<hostname>/configuration.nix` -> system configuration for `<hostname>` host.
Host file `hosts/<hostname>/default.nix` use any modules from the `modules/` directory and overrides config values.

## Discovery

- `ls modules` — list all reusable modules (one concern per file: audio, graphics, coding, etc.)
- `ls hosts` — host-specific config (hardware, configurations, module selection)
- `ls docs` — design docs and references

## Commands

```bash
# Build and apply (the primary workflow)
nixos-rebuild switch --flake .#frostbit --sudo

# Dry run — build but don't activate
nixos-rebuild dry-activate --flake .#frostbit --sudo

# Evaluate without building (catches Nix-level errors fast)
nix flake check

# Build the system closure without activating
nix build .#nixosConfigurations.frostbit.config.system.build.toplevel

# Update all flake inputs / a single input
nix flake update
nix flake update <input-name>
```

## MCP Tools

- **nixos** — use to look up NixOS/Home Manager option types and defaults before setting them.
- **arch-linux** — only `search_archwiki` works here. Package install, system diagnostics, and
  other Arch-specific features will fail on NixOS. Use the wiki for Linux concepts and drivers.

## Module Rules

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
A NixOS module cannot read HM values. HM *can* read NixOS config via `osConfig`,
but this repo bridges scopes through flake-parts options instead.
The bridge is flake-parts option set in each host's `configuration.nix` and readable from any scope.

### Other

- Never hardcode home directories — derive from `"/home/${username}"`.
