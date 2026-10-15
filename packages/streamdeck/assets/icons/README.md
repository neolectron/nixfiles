# Key application icons

The Discord, Spotify, OpenAI and OBS paths in `src/ui/brand-icon.tsx` come from Simple Icons **13.21.0**:

- [Discord](https://github.com/simple-icons/simple-icons/blob/13.21.0/icons/discord.svg)
- [Spotify](https://github.com/simple-icons/simple-icons/blob/13.21.0/icons/spotify.svg)
- [OpenAI](https://github.com/simple-icons/simple-icons/blob/13.21.0/icons/openai.svg), used for ChatGPT and Codex
- [OBS Studio](https://github.com/simple-icons/simple-icons/blob/13.21.0/icons/obsstudio.svg)

Simple Icons distributes these paths under [CC0](https://github.com/simple-icons/simple-icons/blob/13.21.0/LICENSE.md). Brand trademarks belong to their respective owners.
The same React SVG renders in the editor's tile picker and on the physical keys.

The Spotifast icon is a monochrome adaptation of the circle/play geometry from
the installed Spotifast **0.12.0** `share/icons/hicolor/scalable/apps/spotifast.svg`,
from [crmne/spotifast](https://github.com/crmne/spotifast/tree/5b7a5dfe8c15542ee82fd7560c1e36496306b6c9)
(the revision pinned in `flake.lock`). Its gradients, rim and shadow are omitted
to match the other key icons and allow the live feedback color to apply.

The editor's `web/elgato-mark.tsx` uses the
[Elgato symbol](https://github.com/simple-icons/simple-icons/blob/13.21.0/icons/elgato.svg)
from the same CC0 release. The casing reference is the official
[Stream Deck + XL product image](https://images.ctfassets.net/h50kqpe25yx1/6CqiRg3O0GyMu4Q8MId1qL/368cad729d6fff4d87adb34577a6cc4b/SD_XL_OpenGraph.jpg).
Its geometry/material are represented in CSS; the marketing photograph is not bundled
or used behind the interactive controls. The wordmark uses the bundled typeface.
