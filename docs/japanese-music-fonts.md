# Japanese music metadata

The system already installs Noto Sans CJK. The Stream Deck and Spotifast need
different fixes because their renderers do not use fontconfig's glyph fallback.

- **Stream Deck:** the music card is React → Takumi → RGB → HID. Takumi explicitly
  registers Liberation Sans, which has no Japanese glyphs. The Nix wrapper now
  supplies `STREAMDECK_CJK_FONT`, an immutable Noto Sans CJK collection. Takumi
  registers its original family names and adds `Noto Sans CJK JP` after Liberation
  Sans. The SVG renderer loads the same collection with system-font discovery
  still disabled. Fixed line heights keep CJK metrics from clipping the title
  and artist in the LCD card.
- **Spotifast 0.13.2:** egui uses fastframe-fonts v0.6.0. Its directory scan stops
  at depth four. NixOS fontconfig lists store roots, so it never reaches
  `share/fonts/opentype/noto-cjk`. The Nix wrapper prefixes the collection's
  `share` directory to `XDG_DATA_DIRS`; the scanner then starts at `share/fonts`.
  Existing XDG directories and the compatible Mesa selection are preserved.
  The upstream scanner chooses the regional face from the locale; this does not
  change the user's locale or force the Japanese interface language.

## Verification without a player

Use the development shell for the same font and pnpm version as the package:

```sh
nix-shell packages/streamdeck/shell.nix
pnpm check
nix flake check
nix build .#nixosConfigurations.frostbit.config.home-manager.users.neolectron.home.activationPackage
```

`test/fonts.test.tsx` rasterizes distinct Japanese characters through both native
engines, checks the real music-card RGB dimensions, and compares a title glyph's
complete strokes against an unclipped reference. Nix runs this regression during
the Stream Deck package build. It needs no Spotify, MPRIS, audio or HID access.

The source renderer still works without `STREAMDECK_CJK_FONT` for Latin-only
development. Japanese regression tests require the Nix shell. A configured but
unreadable collection fails explicitly rather than silently losing glyphs.

## Activation

Builds do not activate these changes. Integrate the font-only diff into the main
checkout while preserving its pending work. Review and activate that combined
configuration with the repository helper:

```sh
scripts/nixos-rebuild-gui dry-activate --flake .#frostbit
# Only after reviewing a successful dry activation:
scripts/nixos-rebuild-gui switch --flake .#frostbit
```

The new Stream Deck process must use the rebuilt wrapper. Reopen Spotifast at a
convenient time after activation: its fallback list is cached for the process
lifetime. Do not interrupt a current listening session just to refresh fonts.
