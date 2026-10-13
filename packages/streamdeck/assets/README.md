# Mixer renderer assets

Fonts: unmodified Liberation Sans Regular/Bold **2.1.5**, copied from the existing
Nix `liberation-fonts-2.1.5` package. Arial-compatible metrics provide a close visual
substitute for the reference's compact sans-serif lettering; the exact proprietary
Elgato font is not claimed. Distributed under the SIL Open Font License 1.1,
preserved in [fonts/LICENSE](fonts/LICENSE).
Upstream: https://github.com/liberationfonts/liberation-fonts/releases/tag/2.1.5

Spotify, Discord and Google Chrome silhouettes: unmodified Simple Icons **15.0.0**
SVG files from https://github.com/simple-icons/simple-icons/tree/15.0.0/icons.
The original source SVGs are retained here; the renderer applies a local accent.
CC0 text is preserved in [icons/LICENSE.md](icons/LICENSE.md). Icons remain subject
to their respective brands' trademark terms. Speaker/music line icons are authored
in `src/mixer-display.ts` for default output, generic app and mute feedback.

These assets are used by the SVG card renderer and preview CLI. No fonts are
installed globally and rendering never downloads assets or resolves external URLs.
