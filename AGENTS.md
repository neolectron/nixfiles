# nixfiles — Agent Guidelines

This is a NixOS configuration repository for a single user (`neolectron`) running on a single host
(`main`). The entire config is written in Nix using the **dendritic pattern**: every `.nix` file
under `modules/` is a flake-parts module, auto-imported by `import-tree`. The system runs the
**niri** scrollable-tiling Wayland compositor with the **Noctalia** desktop shell.

---

## Repository Layout

```
flake.nix                              # Entrypoint: inputs + mkFlake via import-tree ./modules
flake.lock                             # Pinned input versions (auto-generated)
AGENTS.md                              # This file
modules/
  helpers.nix                          # Shared options: systems, flake.username
  flake-modules.nix                    # Imports flake-parts modules + home-manager flake module
  hosts/
    main/
      default.nix                      # Composition root: assembles nixosConfigurations.main
      configuration.nix                # Base NixOS config (boot, networking, locale, user, nix)
      hardware-configuration.nix       # Hardware-specific config (disks, CPU, kernel modules)
  features/
    niri.nix                           # Niri compositor + greetd auto-login + HM keybindings
    noctalia.nix                       # Noctalia shell bar, widgets, app launcher (HM)
    sound.nix                          # PipeWire audio (NixOS) + pavucontrol (HM)
    audio-interface.nix                # Behringer UMC1820 PipeWire loopback (NixOS)
    discord.nix                        # Discord (HM)
    spotify.nix                        # Spotify (HM)
    graphics.nix                       # AMD GPU acceleration: mesa, Vulkan, VA-API (NixOS)
    coding.nix                         # VSCode, OpenCode, Git, direnv, dev tools (NixOS + HM)
    terminal.nix                       # Kitty terminal (HM)
docs/plans/                            # Design docs and references (informational only)
references/                            # Third-party config repos for reference (gitignored)
configuration.nix                      # Legacy pre-flake config (unused, kept for reference)
hardware-configuration.nix             # Legacy pre-flake hardware config (unused)
```

---

## Reference Repositories

The `references/` directory (gitignored) contains cloned NixOS configurations that use the same
dendritic / flake-parts pattern. **These are the primary source of truth** for how to implement
features, structure modules, and integrate external flake inputs. When implementing something new or
uncertain about a pattern, always check how the references handle it before inventing from scratch.

**Before comparing, always pull the latest changes:**

### How to use references

When implementing a new feature (e.g., adding a browser, gaming, theming):

1. **Pull latest** from the relevant reference repos.
2. **Search** for how they implement it: `grep -r "browser\|firefox\|chromium" references/Christopher2K_NixConfig/modules/`
3. **Adapt** their approach to our pattern (`flake.modules.nixos.*` / `flake.modules.homeManager.*`).
4. Note: Christopher2K uses Home Manager (like us). Goxore/vimjoyer use hjem + wrapper-modules
   (different approach) -- translate their patterns to HM equivalents when borrowing from them.

### Key differences between references and our config

| Aspect               | Our config                  | Christopher2K                     | Goxore/vimjoyer                        |
| -------------------- | --------------------------- | --------------------------------- | -------------------------------------- |
| Auto-import          | `import-tree` (flake input) | `import-tree` (flake input)       | Custom `importTree` via `lib.fileset`  |
| Home management      | Home Manager                | Home Manager                      | hjem (lighter alternative)             |
| Program config       | HM program modules          | HM program modules                | `wrapper-modules` (wrapped packages)   |
| Noctalia integration | `homeModules.default`       | `homeModules.default`             | Wrapped package with baked-in settings |
| Username sharing     | `config.flake.username`     | `config.flake.username`           | `config.preferences.user.name`         |
| Platforms            | `x86_64-linux` only         | `x86_64-linux` + `aarch64-darwin` | Multi-platform                         |

---

## Architecture: The Dendritic Pattern

### Core Concepts

1. **Every `.nix` file is a flake-parts module.** The `import-tree` input recursively discovers all
   `.nix` files under `modules/` and passes them as imports to `flake-parts.lib.mkFlake`. Drop a new
   file in `modules/` and it is automatically loaded -- no manual registration needed.

2. **Feature-oriented organization.** Each feature file can define both NixOS system-level config
   and Home Manager user-level config for the same concern in a single file:

   ```nix
   {
     flake.modules.nixos.<name> = { ... }: { /* system config */ };
     flake.modules.homeManager.<name> = { ... }: { /* user config */ };
   }
   ```

   Not every feature needs both -- omit the namespace that doesn't apply.

3. **Composition root.** The host file (`modules/hosts/main/default.nix`) is where features are
   cherry-picked. It creates `flake.nixosConfigurations.main` by listing which `nixos.*` and `hm.*`
   modules to include. To add or remove a feature from a host, edit only this file.

4. **Shared values via `config.flake.*`.** The username is accessed as `config.flake.username`
   (defined in `helpers.nix`). No `specialArgs` threading is needed.

### Module Namespaces

| Namespace                          | Purpose                                            | Accessed via                              |
| ---------------------------------- | -------------------------------------------------- | ----------------------------------------- |
| `flake.modules.nixos.<name>`       | NixOS system-level module                          | `config.flake.modules.nixos.<name>`       |
| `flake.modules.homeManager.<name>` | Home Manager user-level module                     | `config.flake.modules.homeManager.<name>` |
| `flake.nixosModules.<name>`        | Standalone NixOS module (used for hardware config) | `inputs.self.nixosModules.<name>`         |
| `flake.nixosConfigurations.<host>` | Complete NixOS system configuration                | `nixos-rebuild --flake .#<host>`          |

### Flake Inputs

| Input          | URL                                   | Purpose                              |
| -------------- | ------------------------------------- | ------------------------------------ |
| `nixpkgs`      | `github:nixos/nixpkgs/nixos-unstable` | Package repository                   |
| `flake-parts`  | `github:hercules-ci/flake-parts`      | Flake framework (composable modules) |
| `import-tree`  | `github:vic/import-tree`              | Auto-import all `.nix` files         |
| `home-manager` | `github:nix-community/home-manager`   | User-level config management         |
| `niri`         | `github:sodiboo/niri-flake`           | Niri compositor (NixOS + HM modules) |
| `noctalia`     | `github:noctalia-dev/noctalia-shell`  | Desktop shell (HM module)            |

All inputs except `flake-parts` and `import-tree` follow `nixpkgs` to avoid duplicate evaluations.

---

## Build & Apply Commands

### Apply the configuration

```bash
nixos-rebuild switch --flake .#main --sudo
# or nixos-rebuild dry-activate --flake .#main --sudo
```

The `--sudo` flag runs activation as root while keeping the build unprivileged.

## Important Notes for Agents

- **Never hardcode the username** — always use `config.flake.username` (resolves to `"neolectron"`).
- **Never hardcode the home directory** — derive it from the username: `"/home/${username}"`.
- **`allowUnfree = true`** is set system-wide in `modules/hosts/main/configuration.nix`.
- **niri-flake auto-configures** XDG portals, polkit, gnome-keyring, and swaylock PAM when
  `programs.niri.enable = true`. Do not duplicate these settings.
- **Noctalia is spawned by niri** via `spawn-at-startup` in the HM niri config. Do not use systemd
  user services to start it (deprecated approach).
- **Home Manager is integrated as a NixOS module** (`inputs.home-manager.nixosModules.home-manager`).
  All HM config goes through `home-manager.users.${username}` in the host composition root.
- **The `flake.modules.*` namespaces** are enabled by importing `flake-parts.flakeModules.modules`
  and `home-manager.flakeModules.home-manager` in `modules/flake-modules.nix`.
- When adding a new external flake input, add `inputs.<name>.follows = "nixpkgs"` when the input
  supports it, to avoid duplicate nixpkgs evaluations.
- The old `configuration.nix` and `hardware-configuration.nix` at the repo root are **unused
  leftovers** from before the flake conversion. The active config lives entirely under `modules/`.
- PipeWire SPA JSON uses dotted keys (e.g., `node.name`) that cannot be expressed as Nix attrsets.
  Use `pkgs.writeTextDir` with raw strings for PipeWire config files, as done in
  `audio-interface.nix`.
