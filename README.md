# nixfiles

Extensible Nix configuration with simple and modern defaults.

Built with [flake-parts](https://flake.parts/) and [import-tree](https://github.com/vic/import-tree).

Works on NixOS, any Linux distro, WSL, or macOS.

On linux, the desktop runs the [niri](https://github.com/YaLweT/niri) Wayland compositor with the [Noctalia](https://github.com/noctalia-dev/noctalia-shell) desktop shell.

## Quick start

### Try it without installing

**Coming soon**:
Want to try my config without commiting to it or to NixOS?
You can use the nix and home-manager modules on any Linux distro running Nix on any architecture.

### Apply to your own machine (NixOS)

```bash

git clone git@github.com:neolectron/nixfiles.git

# Build and switch (primary workflow)
nixos-rebuild switch --flake .#yourHostName --sudo

# Dry run — build without activating
nixos-rebuild dry-activate --flake .#yourHostName --sudo

# Catch Nix errors fast, before building
nix flake check
```

## How this repo works

**Key idea:**
`flakes/` is reusable in hosts, and `hosts/` is per-machine.
Users, user preferences, hardware details (monitor placement, keyboard layout) never go in `flakes/`.

```
nixfiles/
├── flake.nix          ← entrypoint, wires up inputs + import-tree
├── flakes/            ← reusable modules (anyone can import these)
│   ├── niri.nix       ← niri compositor + keybinds + layout
│   ├── noctalia.nix   ← noctalia desktop shell integration
│   ├── terminal.nix   ← kitty config
│   ├── coding.nix     ← dev tools
│   ├── sound.nix      ← audio stack
│    ...
└── hosts/
    └── frostbit/      ← one host, machine-specific
        ├── default.nix              ← picks modules, sets username, configures hardware
        ├── hardware-configuration.nix ← filesystems, kernel modules (generated)
        └── config/keybinds.nix                 ← however you wish to split your folders I don't care (e.g. custom keybinds)
```

## Create your own host

it's just two files.

### 1. Generate hardware config

```bash
# On an already-running NixOS system:
nixos-generate-config
# → creates /etc/nixos/hardware-configuration.nix
```

Copy the generated `hardware-configuration.nix` into `hosts/myhost/`.

### 2. Add config to your host

Copy `hosts/minimal/default.nix` to `hosts/myhost/default.nix` and edit the config as you like. The most important part is the `imports` list — this is where you pick which flakes you want on your system.

That's it — `import-tree` auto-discovers your new host file. No need to wire anything manually.

### Override any default

Every "sensible default" in `flakes/` uses `lib.mkDefault`, so you can override it from your host with a plain value:

```nix
# In your host's Home Manager config:
programs.kitty.settings.font_size = 14;           # overrides mkDefault 12
programs.niri.settings.layout.gaps = 16;           # overrides mkDefault 8
programs.niri.settings.cursor.size = 32;            # overrides mkDefault 24
home.pointerCursor.name = "Bibata-Modern-Classic";  # overrides mkDefault "Adwaita"
```

No `mkForce`, no `mkOverride 9001` — just assign the value. The host always wins.

## AI much ?

Embeded with this repo you'll find an opencode agent tailored to help you with your nix configuration !

The agent make use nixOS-mcp and nix LSP to provide you with a seamless experience when it comes to writing and debugging your nix configuration.

Opening opencode to the current directory will automatically load the agent and allow you to ask questions about your configuration, get suggestions for improvements, and even generate new modules based on your needs.
