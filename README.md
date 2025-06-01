# Nixfiles

## Nixfiles is a collection of NixOS configurations to manage your system.

![Nixfiles](./docs/screenshot.png)

### Technical features

- Very clean declarative system configuration for NixOS
- Home Manager for user-land configuration and dotfiles
- Easy to configure, use, and extend
- Sane defaults for a modern and husslte free desktop experience

### Desktop features

- A modern and beatiful Wayland system with Hyprland
- No menus, no clutter, just a clean desktop, a bar, and a launcher (rofi)
- A modern and fast terminal with Kitty

### Installation

- Install NixOS on your machine
- Clone this repository to `/etc/nixos`
- Run `nixos-generate-config` to generate your `hardware-configuration.nix`
- Edit `configuration.nix` to your liking
- Run `nixos-rebuild switch` to apply the configuration

### Customization

- `configuration.nix` is the entrypoint, start reading from there
- You'll notice you need to provide your own `hardware-configuration.nix` ( by running `nixos-generate-config`)
- Then you will find system programs under `system/programs.nix`, only add SYSTEM programs there
- User programs and dotfiles are managed by Home Manager, see `user.nix`.

### Todo

- Fix audio services not remembering audio preferences by using WirePlumber
  (for the time being, right click on the audio icon in the bar and draw with Helvum)
- Fix nerd-fonts not being used correctly in Vscode etc..
- Add more documentation
- Use nix flakes to manage the configuration

- Better default for Hyprland:
  - plugin `split-monitor-workspaces`
  - Adjust too large gaps
  - Set better default Keyboard shortcuts to navigate workspaces with arrows
- Better default for Rofi (launcher):
  - Add a custom theme
  - Only show applications, not all binaries.
  - Allow rofi to input emojis when we seach with ":" as prefix
  - Integrate LLM as well with maybe ! bang prefix
