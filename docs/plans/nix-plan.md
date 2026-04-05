Research Summary
What is the Dendritic Pattern?
The Dendritic Pattern is a NixOS configuration architecture where every .nix file is a flake-parts module. Key principles:

- Feature-oriented: instead of organizing by "system config" vs "home config", you organize by feature (e.g., sound.nix, desktop.nix, coding.nix). A single file can define both NixOS system-level config and Home Manager user-level config for the same feature.
- Auto-importing: using import-tree, every .nix file under modules/ is automatically discovered -- no manual registration needed. Just drop a file and it works.
- No specialArgs: shared values (like username) are passed through config.flake.\* options, not threaded through specialArgs.
- Locality: all config related to one concern lives together in one file.
  Why would you want this?

1. Composability: pick and choose features per host by importing modules selectively
2. Scalability: add a new feature = add one file, zero changes elsewhere
3. Clarity: find everything about "discord" in discord.nix, everything about "niri" in niri.nix
4. Multi-host ready: when you add a second machine, you just create a new host file and compose different features
   Key Technologies

- Niri: a scrollable-tiling Wayland compositor. Configured via niri-flake from sodiboo.
- Noctalia Shell: a beautiful Wayland desktop shell (bar, notifications, panels, app launcher, lock screen) built on Quickshell/QML. Has native Niri support and provides homeModules.default for Home Manager.
- flake-parts: framework that structures flake outputs as composable modules
- import-tree: auto-imports all .nix files from a directory tree as flake-parts modules

---

Proposed Plan
File Structure
nixfiles/
├── flake.nix # Entry point: inputs + mkFlake with import-tree
├── flake.lock # Auto-generated lock file
├── modules/
│ ├── helpers.nix # Shared options (username, systems)
│ ├── flake-modules.nix # Register flake-parts + home-manager flake modules
│ ├── hosts/
│ │ └── nixos-vm/
│ │ ├── default.nix # Assembles nixosConfiguration from feature modules
│ │ ├── configuration.nix # Boot, networking, locale, users, display
│ │ └── hardware-configuration.nix # Current VM hardware (replace later)
│ ├── features/
│ │ ├── niri.nix # Niri compositor (NixOS + Home Manager config)
│ │ ├── noctalia.nix # Noctalia shell (Home Manager config)
│ │ ├── sound.nix # PipeWire audio
│ │ ├── discord.nix # Discord/Vesktop
│ │ ├── coding.nix # VSCode, OpenCode, Git
│ │ └── terminal.nix # Kitty terminal
│ └── users/
│ └── neolectron.nix # Home Manager base user config
├── references/ # (gitignored, stays as-is)
├── .gitignore
└── context-prompt.md
Detailed Steps

1. Create flake.nix

- Inputs: nixpkgs (unstable), flake-parts, import-tree, home-manager, niri (niri-flake), noctalia (noctalia-shell), opencode
- Outputs: flake-parts.lib.mkFlake with import-tree ./modules
- Minimal inputs -- only what you need

2. Create modules/helpers.nix

- Define config.systems = ["x86_64-linux"]
- Define config.flake.username = "neolectron" as a shared option
- Keep it simple -- no multi-platform helpers needed for now

3. Create modules/flake-modules.nix

- Import flake-parts.flakeModules.modules and home-manager.flakeModules.home-manager

4. Create modules/hosts/nixos-vm/default.nix

- Define flake.nixosConfigurations.nixos-vm using nixpkgs.lib.nixosSystem
- Compose the host from feature modules: nixos.configuration, nixos.niri, nixos.sound, nixos.discord, nixos.coding, nixos.terminal
- Set up Home Manager integration inline with hm.neolectron, hm.niri, hm.noctalia, hm.coding, hm.terminal

5. Create modules/hosts/nixos-vm/configuration.nix

- Migrate your current configuration.nix into a dendritic module: flake.modules.nixos.nixosVmConfiguration
- Import hardware config, set boot, networking, locale, user, auto-login, Nix settings
- Remove Hyprland/Plasma6 (replaced by Niri)
- Remove Steam/OBS (not in your minimal list)

6. Move hardware-configuration.nix into modules/hosts/nixos-vm/

- Wrap it as flake.nixosModules.nixosVmHardware so it fits the dendritic pattern

7. Create modules/features/niri.nix

- NixOS side: programs.niri.enable = true, XDG portal config, SDDM with auto-login
- Home Manager side: import niri.homeModules.niri, configure keybindings, layout, spawn-at-startup (noctalia-shell)

8. Create modules/features/noctalia.nix

- Home Manager side: import noctalia.homeModules.default, enable programs.noctalia-shell with basic settings (bar position, widgets, etc.)

9. Create modules/features/sound.nix

- NixOS side: PipeWire with ALSA + PulseAudio compat
- Home Manager side: pavucontrol

10. Create modules/features/discord.nix

- Home Manager side: install vesktop (better Discord client for Wayland)

11. Create modules/features/coding.nix

- NixOS side: programs.nix-ld.enable, unfree packages
- Home Manager side: VSCode, OpenCode, Git (with your name/email config), gh, jq

12. Create modules/features/terminal.nix

- Home Manager side: Kitty terminal with basic config

13. Create modules/users/neolectron.nix

- Set home.username, home.stateVersion

14. Update .gitignore

- Keep references ignored, add result (nix build output)
  What gets removed from current config
- Hyprland, Plasma 6, SDDM Plasma theme
- Steam, OBS
- Hyper-V specific stuff (will be in hardware-config, replaceable)
- google-chrome (not in your list; noctalia has a browser-independent launcher)
- vulnix, nixfmt-classic (not essential for minimal)
  What's new
- Niri as the window manager
- Noctalia as the desktop shell (bar, launcher, notifications, lock screen)
- Proper flake with dendritic module structure
- Home Manager for user-level dotfile management
- Clean separation of concerns by feature
  How to apply (after implementation)

# From the nixfiles directory:

sudo nixos-rebuild switch --flake .#nixos-vm
When you move to real hardware:

1. Boot NixOS installer
2. Run nixos-generate-config to get new hardware-configuration.nix
3. Replace the VM hardware config with the real one
4. Create a new host (e.g., modules/hosts/main/) or rename nixos-vm
5. sudo nixos-rebuild switch --flake .#main
