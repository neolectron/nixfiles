# React / Takumi trial

Isolated clone: `task-11/nixfiles-streamdeck`, branch
`feat/streamdeck-usb-hello`. Hardware: Stream Deck + XL `0fd9:00c6`, six dials,
LCD 1200×100, actual card widths 168/216/216/216/216/168. Main checkout and
installed keep-awake integration are preserved. No Nix activation or USB
permission change was performed.

## What runs

`src/react-mixer.ts` contains pure React HTML/CSS/SVG cards.
`src/takumi.ts` converts their static markup with `@takumi-rs/helpers/html`,
then renders it using the native `@takumi-rs/core` 2.15.2 addon. React and
React DOM are pinned to 19.3.0. Fonts are bundled; no browser process is used.

The renderer is shared and serialized with an Effect semaphore. Rendering is
uninterruptible while a native job runs: the public async wrapper exposes no
cancellation parameter, so the permit must remain held until completion. All
file operations use Effect platform services. Native errors become typed
`StreamDeckError`s. RGB output requires an opaque background and strips alpha.

The existing Effect controller owns audio, pending requests, input subscription,
USB cleanup, pagination and feedback. It repaints changed cards only. Page
routing is committed after the corresponding images are written. A horizontal
swipe starting in the app region changes pages; vertical gestures and swipes
starting on Master do not. Master stays on the rightmost dial. This is page
navigation, not continuous or animated scrolling.

The [official HID protocol](https://docs.elgato.com/streamdeck/hid/stream-deck-plus-xl/)
uploads JPEG images, including rectangular LCD regions. It reports completed
tap/hold/swipe gestures, with no continuous finger coordinates. React does not
change those hardware capabilities. The community HID driver performs image
compression and orientation.

## Upstream retained React proof

The published `@fcannizzaro/streamdeck-react` 0.3.0 was tested separately in
`/tmp/task-11-react-trial`, with an in-memory adapter, workers disabled and no
hardware connection. Its entrypoint failed to import without the optional
`@elgato/streamdeck` SDK because a module eagerly imports it. Adding the SDK
2.0.2 in that temporary package made the trial run. No SDK connection was opened.

A component using `useState` and `useKeyDown` rendered a counter, received a
mock key press, changed from 0 to 1, and emitted a different PNG:

```json
{"kind":"upstream-react-trial","version":"0.3.0","initial":0,"afterKeyDown":1,"changedImage":true,"png":true,"publicClose":false}
```

The public Plugin type exposes `connect`, but neither `disconnect` nor
`dispose`. Default key geometry is 144×144 and segment geometry 200×100,
requiring adjustments for this device. The adapter does not expose a swipe
callback. Private root teardown exists but is not a supported public contract.
Consequently this package is not a production dependency. Its
[architecture](https://streamdeckreact.fcannizzaro.com/concepts/architecture)
and [adapter API](https://streamdeckreact.fcannizzaro.com/concepts/adapter)
remain useful references for a future retained React integration.

Our current bridge uses `renderToStaticMarkup`: it does **not** run persistent
React hooks, effects or DOM handlers. State and physical handlers remain
Effects. Native `.ts` execution, `.ts` imports, no barrel, `noEmit`, no build
script and no direct Node built-in imports are preserved. JSX would require
a runtime transform; no loader has been added.

## Try it

From a shell in this clone, after stopping another owner of the device:

```sh
nix-shell packages/streamdeck/shell.nix
pnpm install --frozen-lockfile
pnpm dev --renderer react --mock-audio --path /dev/hidraw8
```

This uses real HID with eight simulated apps and a simulated output. The first
page shows Demo 1–5; swiping left shows Demo 6, Discord and Spotify. Turn/click
a dial to change/mute the displayed fake app. Master remains fixed. Omitting
`--mock-audio` uses real playback applications and the existing PipeWire-Pulse
Audio service. Check `pnpm streamdeck list` if the device path changes.

```sh
pnpm dev --renderer react --path /dev/hidraw8
pnpm streamdeck preview --renderer react --output /tmp/react-mixer.png
pnpm streamdeck benchmark
```

## Evidence

- Monorepo typecheck passes; Stream Deck: 48 tests; keep-awake: 22 tests.
- React tests cover exact-size RGB/PNG, escaping and nominal/boost/mute/offline
  states, swipe routing to the newly displayed app, volume/mute changes,
  unchanged Master painting and scoped device closure.
- CLI previews for both renderers pass with no command search path and no
  system font configuration, without loading HID or executing audio commands.
- Frozen pnpm install and `nix flake check` pass (existing unknown-output warnings).
- Real HID connection and all six initial React card uploads succeeded.
  Visible rendering and physical gesture confirmation are pending Manuel's reply.

The [preview](preview.png) shows three illustrative rows, not live audio values.
The [benchmark log](benchmark.log) contains 40 warmed samples for each renderer,
at 216×100. An initial run measured SVG median 2.579 ms / p95 3.514 ms and React
median 2.834 ms / p95 6.472 ms. These include markup, layout/raster and RGB
conversion, excluding JPEG encoding and USB transfer. They establish the cost
of this card on this machine, not a frame-rate guarantee. The stored log is a
separate repeat. Startup includes native import and font loading.
