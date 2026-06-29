# Config Scope Separation

This repo uses three independent module system evaluations. Each produces its own `config`
that is invisible to the others.

## The three scopes

- **Flake-parts** -- evaluated by `lib.evalModules` inside `mkFlake`. Option namespace:
  `flake.*`, `perSystem.*`, etc. Completely separate from NixOS and Home Manager.

- **NixOS** -- evaluated by `nixpkgs.lib.nixosSystem`, which runs its own `evalModules`.
  The `config` argument inside NixOS modules refers to NixOS options only.

- **Home Manager** -- evaluated as a nested module system (as a NixOS submodule under
  `home-manager.users.<name>`, or standalone via `homeManagerConfiguration`).
  HM modules receive their own `config` with HM options.

Each `evalModules` invocation produces its own independent `config`. They cannot see each
other by default.

## Cross-scope visibility

- **NixOS -> HM:** impossible. No standard mechanism exists for a NixOS module to read
  Home Manager option values.

- **HM -> NixOS:** possible via `osConfig`. When HM is integrated as a NixOS module,
  it passes `osConfig` as a special argument to HM modules, containing the full NixOS
  config. This repo does not use `osConfig`; it uses the flake-parts bridge instead.

- **Flake-parts -> NixOS/HM:** via lexical closure. The outer flake-parts module function
  captures `inputs` and flake-parts `config` values in `let` bindings. Inner NixOS/HM
  module functions close over those bindings. See `modules/niri.nix` for an example.

## The bridge pattern

This repo bridges scopes through flake-parts options:

1. Hosts define shared values in flake-parts scope (e.g. `config.flake.username`).
2. These are captured in `let` bindings in the outer module function.
3. Inner NixOS/HM module functions close over those bindings via standard Nix lexical scoping.

This avoids `specialArgs`, `extraSpecialArgs`, and `osConfig` entirely.

## The dendritic pattern

This repo follows the **dendritic pattern**: every `.nix` file (except entry points like
`flake.nix`) is a top-level flake-parts module. Each file implements a single feature across
all configuration scopes it applies to. Lower-level NixOS/HM modules are stored as option
values in the top-level config and auto-imported via `import-tree`.

Reference: https://dendritic.oeiuwq.com/
Reference: https://github.com/mightyiam/dendritic
