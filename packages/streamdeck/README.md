# Stream Deck / Effect v4

A small TypeScript library for scripting USB Stream Decks under Linux, with
**Effect 4.0.4**. The tested hardware is a **Stream Deck + XL, `0fd9:00c6`**:
36 LCD keys (112×112), six clickable dials and one touch LCD strip (1200×100).
Capabilities come from the detected model; indices and image sizes are validated.

The community `@elgato-stream-deck/node` 7.8.0 handles HID packets, JPEG encoding
and model-specific orientation. Our package owns scoped resources, typed events,
display operations and behavior routing. It works without the Elgato application.
The CLI itself uses Effect's `Command`, `Flag` and `Schema` APIs from `effect/cli`,
with generated help and Node platform services; there is no custom argument parser.

See the [research and design decisions](../../docs/streamdeck-effect-v4-research.md),
[Effect verification](../../docs/streamdeck-effect-v4-verification.md) and
[original physical proof](../../docs/streamdeck-hardware-2026-10-13.md).

## Run

From the isolated repository clone opened in VS Code:

Node 24 runs the `.ts` sources directly using its built-in type stripping. There
is no build step, loader or generated JavaScript. Type checking uses `tsc` with
`noEmit`, `allowImportingTsExtensions` and `erasableSyntaxOnly`; the inherited
`verbatimModuleSyntax` keeps type-only imports explicit. See
[Node's TypeScript support](https://nodejs.org/docs/latest-v24.x/api/typescript.html).
Local imports include `.ts` extensions. Import individual modules instead of a
barrel, for example `@nixfiles/streamdeck/stream-deck` or
`@nixfiles/streamdeck/bindings` from another workspace package.

```sh
nix-shell packages/streamdeck/shell.nix
pnpm install --frozen-lockfile
pnpm dev                                    # live mixer; restart on source changes
pnpm dev --mock                             # live mixer with inert USB/audio
pnpm studio:dev --path /dev/hidraw8          # local editor + real mixer, watch mode
pnpm studio:dev --mock                      # local editor with inert USB/audio
pnpm streamdeck list
pnpm streamdeck:demo                          # finite mock hello
pnpm streamdeck hello --mock --demo --lcd     # mock key + strip
pnpm streamdeck events --mock --demo         # no display writes
pnpm streamdeck hello --lcd --duration 30    # real device
pnpm streamdeck playground                   # edit scripts/playground.ts
pnpm streamdeck pages                        # edit scripts/pages.ts
pnpm streamdeck mixer                        # real app audio mixer
pnpm streamdeck mixer --step 1               # 1 percentage point per tick
pnpm streamdeck mixer --mock --duration 2    # inert device AND audio
pnpm streamdeck preview                      # PNG of mixer states, no USB/audio
pnpm dev --renderer react                   # React HTML/CSS + Takumi native renderer
pnpm dev --renderer react --mock-audio       # real LCD, eight simulated apps; no pactl
pnpm streamdeck benchmark                    # warm card rendering timings, no USB/audio
```

`pnpm dev` uses Node's `--watch` with preserved console output. Changes to loaded
TypeScript modules restart the mixer; the Effect runtime closes the previous
USB handle before reconnecting. Mixer flags also work here, for example
`pnpm dev --path /dev/hidraw8 --step 1`. Ctrl+C stops watch mode.

`--mock` does not import native HID. `--demo` requires mock and is finite.
`--duration` is optional and exits normally. Ctrl+C/SIGTERM interrupts the Effect
runtime and closes the device after pending writes; images remain displayed.
With multiple devices, specify the freshly discovered `--path`. A reconnect can
change hidraw paths, so do not reuse a stale path.

## Local web editor

`pnpm studio:dev` starts the React editor at `http://127.0.0.1:3900` and the same
Effect engine that owns the hardware and real audio mixer. Select a key, choose
an installed desktop application or a command/script, then save. Saving updates
the physical key image and profile without executing the action. A physical press
or **Tester l’action** uses the same handler. The inspector shows command output,
errors and an **Arrêter la commande** control while a command runs. A counter is
also available for an inert test. Command arguments are one per line and remain
literal; shell syntax requires an explicitly configured shell executable.

The preview mirrors successful RGB writes, including partial LCD updates. Held
physical keys and pressed dials remain highlighted until release. Dials keep their live app/mute
assignments; the web page arrows follow the same mixer pagination as LCD swipes,
and Master stays pinned. Selecting a dial explains its current assignment; this
first editor does not yet reconfigure dial/touch behavior.

The default profile is `packages/streamdeck/.studio/profile.json`, ignored by Git;
use `--profile /absolute/path.json` and `--port 3901` to select another profile or
port. Writes use an adjacent temporary file and atomic rename, with mode `0600`.
Concurrent stale edits are rejected. A malformed existing profile stops startup
instead of being replaced. Unconfigured keys keep their old physical images,
which HID cannot read back; the editor marks them as free until it writes them.

The server binds only to loopback and checks the origin and a custom header on
mutations. Closing the browser leaves the deck engine running. Commands belong
to the engine's Effect scope and stop on cancellation or shutdown. `--mock` mocks
USB and mixer audio; **explicitly testing an app/command still executes it on the
host**. Use the counter for fully inert tests.

Backend `.ts` sources run directly in Node 24. Vite transforms the browser's React
and TypeScript modules on demand with HMR; no build script or emitted JS is added.
The shared [key card](src/ui/key-card.ts) and [volume card](src/ui/volume-card.ts)
are pure React views. Effect owns HTTP, SSE, validation, persistence, child process
lifecycle and device state. See the [implementation evidence](../../docs/streamdeck-studio.md).

## App audio mixer

The [Effect mixer script](src/scripts/audio-mixer.ts) lists playback applications
above the left dials, with a percentage and semicircular gauge. Its cards follow
the supplied Elgato references: charcoal rounded surfaces, app icons and mixed-case
names, antialiased sans-serif type, tick marks, pointer and a large value at right.
The gauge keeps 100% vertical at its prominent midpoint and its nominal range
green. The right-hand boost segment follows yellow → orange → red and covers
100–200% for applications, or 100–150% for Master.
Turn the dial to change that app's
output volume (two percentage points per tick by default); click it to toggle
playback mute. Muted feedback shows the stored value, a crossed speaker, grey arc
and `Muted` label. Swipe the LCD left/right for more apps
when they exceed the available app dials (five on the + XL). Existing apps retain their slots as others
appear/disappear; new apps fill empty slots. Long names ellipsize using real font
measurements to fit each region, including the narrow cards at the strip ends.

The [Audio service](src/audio.ts) controls the existing PipeWire-Pulse interface
through `pactl`, available in the standalone Nix shell. It groups playback streams
by app identity and changes all streams belonging to that app. Channel balance
and relative stream levels are preserved; turning a muted app does not unmute it.
The rightmost dial is always `MASTER`, on every page. It changes the default
output's volume and toggles its mute on click. It follows changes to the default
output, preserving that output's channel balance. Pending gestures for an output
that was replaced or is no longer default are discarded instead of affecting the
new output. Master control also works when no application has a playback stream.
Volume is bounded to **0–200% for apps** and **0–150% for Master**. Percentage
text stays white up to 100%, then transitions from yellow through orange to red.
Master reaches orange at 125% and red at 150%; apps reach orange at 150% and red
at 200%. The green half covers 0–100%, with 100% vertical. The colored half
covers the remaining range. External values above a control's ceiling are still
displayed; startup and polling never change them. Dial changes respect that
control's ceiling. Noctalia's `audio.volumeOverdrive` must be enabled for the live
Master to exceed 100%; otherwise the desktop shell resets larger requests.
Startup only reads audio and draws the strip.
The script does not control capture streams or the microphone.
Discord's knob controls its playback audio, not its own microphone mute button.

App discovery includes paused streams that still exist in PipeWire. Apps without
a playback stream cannot be shown yet. App changes and external volume changes
are polled every 500 ms, and dial actions are batched every 40 ms. PipeWire failure
shows an amber icon and `Offline`; routing resumes on a successful poll. USB disconnect
is terminal: restart the CLI with the current device path after reconnecting.

`Audio.Audio` is a separate Effect service (`list`, `change(appKey, { delta,
toggles })`, `master`, `changeMaster(outputSnapshot, change)`), provided by
`Audio.layer` plus Node platform services. The HID
library remains independent of audio. The CLI's `--mock` provides both mocks and
cannot run a real audio command. Process spawning, timeout, cleanup, state,
serialization, polling and CLI parsing use Effect APIs.

## Write a behavior

For a quick experiment, edit [scripts/playground.ts](src/scripts/playground.ts)
and run `pnpm streamdeck playground`. A complete standalone script can look like:

```ts
import { NodeRuntime } from '@effect/platform-node';
import { Effect } from 'effect';
import * as Bindings from '../bindings.ts';
import * as Hid from '../hid.ts';
import { StreamDeck } from '../stream-deck.ts';

const program = Effect.gen(function*() {
  const deck = yield* StreamDeck;
  yield* Bindings.run({
    buttons: {
      0: {
        label: 'HELLO',
        onPress: deck.key(0).label('PRESSED'),
        onRelease: deck.key(0).label('HELLO'),
      },
    },
    knobs: {
      0: { onRotate: ({ delta }) => Effect.log('Signed dial ticks', delta) },
    },
    touch: {
      0: {
        onTap: ({ position }) => Effect.log('Tap', position),
        onHold: ({ position }) => Effect.log('Hold', position),
        onSwipe: ({ from, to }) => Effect.log('Swipe', from, to),
      },
    },
  });
}).pipe(Effect.provide(Hid.layer()));

NodeRuntime.runMain(program);
```

Save it under `src/scripts/my-script.ts` and run from the repo root:

```sh
pnpm --filter @nixfiles/streamdeck exec node src/scripts/my-script.ts
```

Handlers accept an Effect directly or a function returning an Effect. They may
require other services: provide their layers alongside the device layer. Keep
state in `Ref`, and redraw after updating it, as in the playground's level demo.
The default examples change displays and log actions only.

## Hardware API

All operations below return Effects. Obtaining a `key(index)`/`lcd(index)` handle
is pure; executing an operation validates that the control exists and supports it.

| API | Purpose |
| --- | --- |
| `discover.pipe(Effect.provide(Hid.driverLayer))` | Enumerate devices and actual VID/PID, without opening them |
| `Hid.layer({ path?, eventCapacity? })` | Provide one scoped `StreamDeck` service |
| `deck.info`, `deck.buttons`, `deck.dials`, `deck.lcds` | Model and logical control definitions |
| `deck.key(i).label(text, options?)` | Uppercase bitmap label; background, foreground, optional 0–100 gauge |
| `deck.key(i).setImage(image)` | Exact-size logical RGB image |
| `deck.key(i).fill([r,g,b])`, `.clear` | Solid color / black |
| `deck.lcd(i).label`, `.setImage`, `.fill`, `.clear` | Same operations for an LCD strip |
| `deck.lcd(i).drawRegion({ x,y }, image)` | Update a bounded logical region |
| `deck.setBrightness(percent)`, `deck.resetToLogo` | Explicit device-wide changes; never called automatically |
| `deck.firmwareVersion`, `deck.serialNumber` | Explicit identity queries; serial numbers are not logged automatically |
| `deck.events` | Scoped live broadcast Stream of normalized input |
| `deck.subscribe` | Establish a scoped subscription before starting producers |
| `deck.awaitFailure` | Race a custom long-running program against terminal device failure |

`Image.solid(size, color)` and `Image.label(size, text, options)` construct validated
images. `RgbImage` is `{ width, height, data: Uint8Array }`, exactly three RGB bytes
per pixel. Compressed PNG/JPEG bytes are not RGB images; decode them in a renderer
adapter before calling `setImage`. The bundled renderer supports ASCII uppercase
letters/digits, not arbitrary fonts. The driver handles rotation and compression.
The mixer uses a separate optional [SVG renderer](src/svg.ts): `yield* Svg.make`
returns `rgb(svg)`, `png(svg)`, `measure(text, size?, weight?)` and `fit(text, width,
size?)` Effects. It lazily loads resvg, uses two bundled Liberation Sans fonts and
does not depend on system font lookup. The exact Elgato font is not claimed.
The [asset sources and licenses](assets/README.md) are included. HID discovery and
bitmap hello/playground scripts never load the native SVG renderer.

`--renderer react` uses [React cards](src/react-mixer.ts) and the
[Effect Takumi adapter](src/takumi.ts). Write normal React elements with HTML,
inline CSS and SVG; the adapter returns RGB or PNG from `rgb(element, size)` or
`png(element, size)` Effects. It bundles the same fonts and icons as the SVG
renderer. Opaque backgrounds are required for RGB output: alpha is discarded.
Effect owns state, event routing and resource lifetimes. These are stateless
React views rendered with `renderToStaticMarkup`; there is no retained React
root, `useState`/`useEffect` runtime, DOM or browser event handling here. The `.ts`
views use `createElement` so Node keeps running them directly without a loader.
Only changed cards are rendered and uploaded. SVG remains the default.

See the [React/Takumi trial](../../docs/streamdeck-react-poc/README.md) for the
upstream reconciler test, limitations, timings and preview. `--mock-audio`
provides eight independent fake applications and a fake Master, allowing two
pages to be exercised even when few real apps emit audio. Without `--mock`,
the LCD and input events are real; fake volumes never execute `pactl`.

`pnpm streamdeck preview --output /tmp/mixer.png` writes a 1200×316 PNG of three
illustrative LCD rows using the production card renderer. It tests no audio or
hardware. The current design uses arcs for the configured volume; live signal
metering in dBFS is a separate integration and is not represented by these arcs.

The event union has `_tag` variants `KeyDown`, `KeyUp`, `DialDown`, `DialUp`,
`DialRotate` (signed `delta`), `TouchTap`, `TouchHold` and `TouchSwipe`.
Touch coordinates are logical LCD coordinates. Touch is a completed gesture,
not a down/up pair.

## Routing and pages

`Bindings.run(profile)` validates bindings, subscribes before initial rendering
and runs handlers sequentially. Initial feedback can be a per-button `label` or
`image`, plus an optional `render` Effect for the strip or custom feedback.
`onEvent` observes each routed event. Unbound controls cause no action.

A touch binding may be an array of zones with `area: { x, y, width, height }`.
The first matching zone wins; bounds exclude their right/bottom edge. A swipe
routes according to its starting point. A final binding without an area is a
fallback. See the playground for an example.

`Bindings.pages({ home: profile, tools: profile }, 'home')` returns
`{ select, current, run }` in the current scope. `select('tools')` repaints only
keys owned by these pages, clearing stale labels, then commits the active page.
A held key/dial releases into the profile that received its press. See
[scripts/pages.ts](src/scripts/pages.ts) for switching from a button handler.

Errors fail the runner and close its resources. Recover deliberately with Effect
operators. For slow independent actions, explicitly use `Effect.forkScoped` and
handle that fiber's failures; do not block the input router indefinitely.
Disconnect and event overflow are terminal. Default capacity is 256; no input
replay or automatic reconnect. Shared consumers reuse one owning layer.

## Mock and checks

```ts
import { Effect, Stream } from 'effect';
import * as Mock from '../mock.ts';
import { StreamDeck } from '../stream-deck.ts';

const mock = Mock.make();
const testProgram = Effect.scoped(Effect.gen(function*() {
  const deck = yield* StreamDeck;
  const events = yield* deck.subscribe;
  yield* mock.emit({ _tag: 'KeyDown', key: 0 });
  return yield* Stream.runHead(events);
}));
const observed = await Effect.runPromise(testProgram.pipe(Effect.provide(mock.layer())));
// mock.writes, mock.opens and mock.closes are available for assertions.
```

Custom mock devices and write failures use `Mock.make({ devices, onWrite })`.
Use `mock.disconnect()` to exercise device loss. For deterministic tests,
`Bindings.start` exposes a ready subscription and a `run` Effect before you emit.

Platform operations use Effect services and `@effect/platform-node` layers;
source files and tests have no direct Node built-in imports. `Path` resolves file
URLs, `FileSystem` reads assets and owns scoped temporary files, and
`ChildProcessSpawner` runs literal commands with scoped cleanup and timeouts.
Tests use `@effect/vitest` 4.0.4 with Vitest 5.0.4; CLI integration tests use
`it.live` with Node platform services. The test helper reads pnpm's
`npm_node_execpath` through Effect `Config`, keeping child Node execution available
even in tests with an intentionally empty command search path. Run the suite via
`pnpm test` so that pnpm supplies this variable.

```sh
pnpm test
pnpm typecheck
node packages/streamdeck/src/cli.ts hello --mock --demo --lcd
```

Only Stream Deck dependencies changed. The sibling `keep-awake-mcp`, its npm
lockfile, Nix derivation and installed integration are preserved.

## USB permissions

The existing access is Manuel's temporary ACL on the exact + XL hidraw node.
It disappears on disconnect. Permission examples remain **inactive**. Do not run
the scripts as root or grant world-writable access. The narrow persistent example
uses `TAG+="uaccess"` for `0fd9:00c6` before `73-seat-late.rules`, via
`services.udev.packages`; integrating it belongs to the host configuration and
the parent-managed Nix activation workflow. No NixOS activation was performed.
