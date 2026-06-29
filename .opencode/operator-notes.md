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

## Battle for Middle-earth II on NixOS/Wine

- User has `/home/neolectron/dev/bfme2` with `cd_keys.txt`, `Options.ini`, and `tBfMe.iso`.
  Note: T3A lists `tBfMe.iso` as BFME1; BFME2 ISO is named `tBfMe_II.iso` and RotWK is `tRotWk_ep.iso`.
- Key online sources: PCGamingWiki BFME2 page, T3A:Online downloads/setup, Lutris BFME2 installers,
  GameReplays BFME2 1.09 and RotWK 2.02 pages.
- Modern fix themes: create `%APPDATA%/My Battle for Middle-earth(tm) II Files/options.ini`, avoid SafeDisc by using
  community patch switcher / no-CD game.dat from patch, use T3A:Online/Tacitus for multiplayer, UDP 16000 for P2P.
- Best multiplayer recommendation found: if playing expansion, prefer RotWK + unofficial patch 2.02 >= 9.0 because it
  fixes the long-standing off-host command delay. Base BFME2 1.09 does not fix off-host delay.

## Battle.net / StarCraft II via Steam Proton

- Working Proton prefix found at:
  `/home/neolectron/.local/share/Steam/steamapps/compatdata/2942230789`
- Battle.net launcher:
  `/home/neolectron/.local/share/Steam/steamapps/compatdata/2942230789/pfx/drive_c/Program Files (x86)/Battle.net/Battle.net Launcher.exe`
- StarCraft II install exists at:
  `/home/neolectron/.local/share/Steam/steamapps/compatdata/2942230789/pfx/drive_c/Program Files (x86)/StarCraft II`
- Steam shortcut was stale and pointed at `3090011381`; fixed by moving the partial old prefix to
  `3090011381.partial-backup` and symlinking `3090011381 -> 2942230789`.
- Cause: Steam non-Steam compatdata IDs are tied to shortcut identity; deleting/re-adding/changing non-Steam shortcuts can create new IDs and Battle.net then “forgets” existing installs.
- Practical rule: do not delete/re-add the Battle.net Steam shortcut after it works; edit only the existing shortcut, and preserve the `2942230789` prefix.

## Spotify on NixOS

- `nixpkgs` commit `c6e5ca3c836a5f4dd9af9f2c1fc1c38f0fac988a` is the newest known pin I found for Spotify in this config.
- On Linux it evaluates to `spotify 1.2.84.475.ga1a748ff`, not `1.2.88.483`.
- So `1.2.88.483` is not currently reachable here via plain nixpkgs; likely needs a third-party overlay/backport.
