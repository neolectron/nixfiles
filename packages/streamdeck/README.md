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

```sh
nix-shell packages/streamdeck/shell.nix
pnpm install --frozen-lockfile
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
```

`--mock` does not import native HID. `--demo` requires mock and is finite.
`--duration` is optional and exits normally. Ctrl+C/SIGTERM interrupts the Effect
runtime and closes the device after pending writes; images remain displayed.
With multiple devices, specify the freshly discovered `--path`. A reconnect can
change hidraw paths, so do not reuse a stale path.

## App audio mixer

The [Effect mixer script](src/scripts/audio-mixer.ts) lists playback applications
above the dials, with a percentage and gauge. Turn the dial to change that app's
output volume (two percentage points per tick by default); click it to toggle
playback mute. Red feedback says `MUTED`. Swipe the LCD left/right for more apps
when they exceed the available dials. Existing apps retain their slots as others
appear/disappear; new apps fill empty slots. Long names use the first 12 characters.

The [Audio service](src/audio.ts) controls the existing PipeWire-Pulse interface
through `pactl`, available in the standalone Nix shell. It groups playback streams
by app identity and changes all streams belonging to that app. Channel balance
and relative stream levels are preserved; turning a muted app does not unmute it.
Normal volume is bounded to 0–100%; an already amplified stream can be reduced,
but is never further amplified. Startup only reads audio and draws the strip.
The script does not control capture streams, the microphone, or the master sink.
Discord's knob controls its playback audio, not its own microphone mute button.

App discovery includes paused streams that still exist in PipeWire. Apps without
a playback stream cannot be shown yet. App changes and external volume changes
are polled every 500 ms, and dial actions are batched every 40 ms. PipeWire failure
shows amber `AUDIO OFFLINE`; routing resumes on a successful poll. USB disconnect
is terminal: restart the CLI with the current device path after reconnecting.

`Audio.Audio` is a separate Effect service (`list`, `change(appKey, { delta,
toggles })`), provided by `Audio.layer` plus Node platform services. The HID
library remains independent of audio. The CLI's `--mock` provides both mocks and
cannot run a real audio command. Process spawning, timeout, cleanup, state,
serialization, polling and CLI parsing use Effect APIs.

## Write a behavior

For a quick experiment, edit [scripts/playground.ts](src/scripts/playground.ts)
and run `pnpm streamdeck playground`. A complete standalone script can look like:

```ts
import { NodeRuntime } from '@effect/platform-node';
import { Effect } from 'effect';
import { Bindings, Hid, StreamDeck } from '../index.js';

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
pnpm --filter @nixfiles/streamdeck exec node --import tsx src/scripts/my-script.ts
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
import { Mock, StreamDeck } from '../index.js';

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

```sh
pnpm test
pnpm typecheck
pnpm build
node packages/streamdeck/dist/cli.js hello --mock --demo --lcd
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
