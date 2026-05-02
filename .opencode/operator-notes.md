# Operator notes

## Chataigne AppImage (1.10.3)

- Missing runtime libraries encountered so far in `appimageTools.wrapType2`:
  - `lz4` (fixes `liblz4.so.1`)
  - `libbsd` (fixes `libbsd.so.0`)
- `extractType2` output for this AppImage contains:
  - `chataigne.desktop`
  - `chataigne.png`
  - `.DirIcon`
- Upstream desktop file uses `Exec=Chataigne`; wrapper binary is `chataigne`.
  Patch desktop entry to `Exec=chataigne` during install.
- Vicinae logs show it rescans `~/.local/share/applications` on changes.
  If package desktop files under profile paths are not picked up immediately,
  define `xdg.desktopEntries.<name>` in Home Manager to force a local desktop file.

## CurseForge AppImage (1.300.0-31983)

- Reference used: `references/vincent-hd_nixfiles/modules/curseforge.nix`.
- `appimageTools.wrapType2` gives `bin/curseforge` but no guaranteed local launcher visibility.
  Keep a matching `xdg.desktopEntries.curseforge` in HM to ensure launcher and icon indexing.
- On frostbit + Vicinae, profile desktop entry existed under `/etc/profiles/per-user/neolectron/share/applications`
  but launcher still missed it; placing desktop file directly in `~/.local/share/applications` fixed discovery.
