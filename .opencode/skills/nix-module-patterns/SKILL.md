---
name: nix-module-patterns
description: Workflow for creating or modifying NixOS/Home Manager modules in this flake-parts + import-tree codebase. Load this before writing new .nix modules or making structural changes.
---

# Nix Module Patterns

## Before You Start

1. Read 1-2 existing modules to match their style:
   - `modules/sound.nix` — minimal dual-scope module (NixOS + HM)
   - `modules/discord.nix` — minimal HM-only module
   - `modules/niri.nix` — complex module with flake inputs and `lib.mkDefault`
   - `modules/wsl-mount.nix` — module with custom options and `lib.mkIf`

## Workflow

### 1. Create `modules/<kebab-name>.nix`

Auto-imported by `import-tree` — no registration needed.

### 2. Write the module skeleton

The outer function is a flake-parts module. Inside, define NixOS and/or HM modules. Only define
the scopes you need.

```nix
{ ... }:
{
  flake.modules.nixos.<camelCaseName> =
    { pkgs, ... }:
    {
      # NixOS system config
    };

  flake.modules.homeManager.<camelCaseName> =
    { pkgs, ... }:
    {
      # Home Manager user config
    };
}
```

Module name is camelCase derived from filename: `audio-interface.nix` -> `audioInterface`.

### 3. Access flake inputs (if needed)

Inputs are captured from the outer flake-parts scope via lexical closure — the inner NixOS/HM
functions close over `inputs`. Do not use `specialArgs` or `extraSpecialArgs`. Read
`modules/niri.nix` for the real pattern.

When adding a new flake input, add `inputs.<name>.follows = "nixpkgs"` when supported.

### 4. Wire it into a host

Edit `hosts/<hostname>/default.nix` — add to the NixOS modules list and/or the HM imports list.
Read the file to see the existing pattern.

### 5. Validate

Run `nix flake check` to catch evaluation errors.
