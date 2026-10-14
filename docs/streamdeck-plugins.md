# Effect plugins for the Stream Deck

The USB connection, preview mirror and editor belong to the host. Each enabled
plugin gets its own scope, a declared set of controls and a revocable `StreamDeck`
service. Enabling builds its services; disabling interrupts its tasks and actions,
unsubscribes sources, closes Layer resources and clears its owned displays.
Other plugins keep running and the physical connection stays open.

System bindings live in `@nixfiles/system-control`: Audio, MPRIS/Spotify, media
and Discord can be used without the deck. Studio provides shared system Layers
at its root; presentation plugins reuse them. Disabling a presentation does not
close a shared integration. Standalone plugins can still own their own service
scope. See [the service API](../packages/system-control/README.md).

## Export ready-to-assign key tiles

An action can export a `tile` alongside its Schema, defaults and handler:

```ts
const launch = Plugin.action({
  id: 'launch',
  name: 'Ouvrir mon application',
  description: 'Ouvre l’application ou active sa fenêtre existante.',
  input: Plugin.NoInput,
  defaults: {},
  tile: { label: 'Mon app', icon: 'play' },
  run: (api: MyController) => api.open,
  feedback: (api) =>
    Effect.map(api.running, (running) => ({
      icon: 'play',
      text: running ? 'OUVERT' : 'FERMÉ',
      tone: running ? 'positive' : 'neutral',
    })),
});
```

Include this action in `actions` on `Plugin.define` / `Plugin.fromLayer`. It appears
under **Tiles des plugins** in the key inspector, even when the plugin is disabled.
Selecting it prepares the label, action and typed default parameters; saving never
executes it. The usual trigger selector still supports short, long and double presses.
The browser preview and hardware share `KeyCard` / `FeedbackIcon`. No plugin-specific
editor component or USB writer is needed. Without `feedback`, `tile` supplies its
icon with **PRÊT**; disabling uses **DÉSACTIVÉ**. A custom `unavailable` overrides that.

Discord, Spotify / Spotifast, OBS and ChatGPT / Codex export launch tiles with their
brand icons. `application-tiles.ts` is their small presentation adapter;
`system-control/Desktop` owns XDG discovery, window state, launching and focus.
The Spotify tile prefers an existing player, otherwise launches Spotifast when
installed and falls back to Spotify. Launch tiles display **OUVERT**, **FERMÉ**,
**NON INSTALLÉ**, or **ÉTAT INCONNU**. Open/closed refers to a matching niri window;
an app running only in the tray has no open window. Window state refreshes every
second through one shared Desktop service. A press rechecks windows before opening
or focusing. Launching uses literal `gio launch` arguments and unreferences the
launcher, so disabling the plugin does not terminate the user’s GUI application.

ChatGPT / Codex launch tiles are separate from Dot push-to-talk: opening an app
needs neither microphone capture nor a configured voice bridge. OBS activation
is independent of WebSocket availability. Its managed system Layer owns background
reconnects; offline RPC actions return `IntegrationError` and leave launch/configuration
available. Launching OBS never starts recording. These are key-action presets,
not the future LCD SurfaceHost/scene tile contract described in the architecture plan.

## Use the built-in plugins

The editor's **Plugins** tab controls **Mixer audio**, **Applications et scripts**, **Raccourcis**
and personal plugins. Each list row expands to show its details and any available
configuration fields; Discord's connection form lives inside its own row. Activation
stays accessible while the row is collapsed. The **Édition** tab retains the selected
key/dial and unsaved drafts when switching between tabs.
Their enabled preferences are atomically saved with mode `0600` alongside the key
profile, in `<profile>.plugins.json`. Existing profiles default to all three enabled.
New personal plugins default to disabled. Unsupported hardware and source errors
are visible in the editor. Two plugins cannot claim the same key, dial or LCD;
disable the current owner before enabling its replacement.

The existing audio behavior lives in `src/plugins/audio-mixer.ts`:

```ts
import { Effect } from 'effect';
import { PluginHost } from '../plugin-host.ts';
import * as AudioMixer from '../plugins/audio-mixer.ts';

const script = Effect.gen(function* () {
  const host = yield* PluginHost;
  const mixer = yield* host.install(AudioMixer.plugin({ renderer: 'react' }));
  yield* host.setEnabled(mixer.id, true);
  yield* mixer.use((api) => api.changePage(1));
  yield* mixer.use((api) => api.adjustDial(0, 2));
  yield* mixer.use((api) => api.flush);
});
```

Provide the script with `PluginHost.layer`, the chosen HID/mock layer, an `Audio`
layer and platform services, and keep its enclosing scope alive while it runs.
`mixer.use` resolves the current activation; don't retain old service instances.
Its callback runs in that activation's scope and receives its owned `StreamDeck`
service. Caller interruption cancels the call; disabling cancels calls still in
flight. `current` is for optional read-only snapshots. Re-enabling constructs
fresh services; transient counters/output reset, saved configuration survives.

## Connect a source in the studio

Edit `packages/streamdeck/src/studio-plugins.ts`. The shipped example registers a
clock source without enabling it. Replace its source, or register more plugins:

```ts
import * as Sources from '@nixfiles/system-control/sources.ts';

const source = Sources.poll(myService.currentState, '1 second').pipe(
  Stream.map((value) => value.title),
);
yield * host.install(EventDisplay.plugin(source, 0));
```

The example has React feedback and a physical press counter. It owns key index
`0` (touch 1 in the UI); **Raccourcis** owns all keys, so disable Raccourcis before
enabling the example. Mixer audio can remain enabled because it owns other
controls. `pnpm cli plugins --mock --duration 3` runs the same example independently
without HID or real audio. All entry points use Effect CLI and Node's `tsx` runtime loader.

`Sources.poll` returns an ordinary Effect `Stream`. Apply `Stream.map`, `filter`,
`merge`, `changes`, `debounce`, or explicit retry/recovery before consumption.
`Plugin.listen(source, handler)` preserves ordering and backpressure for ordinary
Effect callbacks. Declared-action/background handlers explicitly allow concurrent
execution; a finite source waits for their dispatched tasks before completing. A finite
source can finish while the plugin remains active; a failure stops that plugin,
releases its controls and exposes the error. It can be retried by re-enabling it.

SDKs and EventEmitters can be adapted in one place:

```ts
const source = Sources.callback<string>((emit) => {
  const listener = (event: { title: string }) => {
    emit(event.title);
  };
  sdk.on('change', listener);
  return () => sdk.off('change', listener);
});
```

The callback registers when consumed and unregisters when its plugin stops.
Default capacity is 256; overflow fails visibly rather than silently losing
commands. For replaceable snapshots such as live levels, pass
`{ capacity: 1, latest: true }`. An existing HTTP/SSE, socket, MQTT or PubSub Stream
can be used directly; transport-specific dependencies belong to its own Layer.

## Standard desktop media controls

The **Touches média** plugin (`media`) declares `previous`, `play-pause`, `next`,
`play`, `pause` and `stop`, with no parameters. These are global media commands
over Linux MPRIS rather than commands bound to Spotify's particular D-Bus name.
`media.ts` discovers players using the existing `MprisTransport` Layer and reuses
the per-player controller for capability checks and serialized commands. It
selects one player per action; it never broadcasts a toggle to every application.

Playing players take priority over paused/stopped players. A player observed
starting playback takes priority within that group; otherwise selection stays
stable, with D-Bus name order as the initial tie-breaker. A paused selected player
remains selected when no other player is playing. Reopening/closing applications
updates the selection. Discovery and feedback are read-only, use
`--auto-start=no`, and recover from missing players without disabling the plugin.
The key shows the selected application and a play/pause icon matching its state.
The `MediaPlayers` system Layer owns monitoring. In Studio it remains alive
when the media presentation is disabled; standalone activation closes its own
Layer with the plugin scope.

On Manuel's current deck the plugin is enabled and standard Previous,
Play/Pause and Next were placed on keys 21–23, directly above the corresponding
Spotify keys 30–32. The saved profile was changed through the studio API with
captured slot addresses and an expected empty binding. The real feedback selects
`spotifast`; no playback/track mutation was used to configure the buttons.

## Contribute an interactive mixer card

The Spotify plugin resolves Spotify and Spotifast independently and registers its
now-playing view in `MixerCards`. Touching a player's card toggles the volume gauge
and track view; the latter displays title, artists, elapsed time, duration and
progress. Knob rotation and clicks continue to use the audio mixer. MPRIS timing
is sampled every second and advances according to playback rate only while playing;
paused tracks keep a fixed position. Missing timing is shown as unknown.
While the track view is selected, rotating its knob immediately adds a circular
volume overlay on the artwork, with the percentage centered. Each rotation extends
a 1.5-second deadline; the next mixer refresh after expiry removes the overlay.
The expanded card, title, artists and progress remain visible. This feedback preserves the user's
selected view and is independent for Spotify and Spotifast. Touching the card
explicitly changes its selected view and clears the temporary feedback.

`src/mixer-cards.ts` is a generic scoped extension point. A contribution declares
`matches(app)`, `frame(app, size)` and an optional labeled `tap.run(app)` Effect.
Optional `onAdjust(app, change)` receives local knob adjustments before the mixer
flushes audio changes; its resulting content is rendered immediately. This is
a scoped notification, not a second volume writer. Spotify uses `Clock` and `Ref`
to temporarily show volume within its track view, with no timer
fiber or application-specific logic in the mixer.
Returning no frame uses the mixer's normal volume card. A frame supplies a change
stamp and a lazy RGB render Effect; unchanged stamps avoid rendering and USB writes.
`expandIntoEmpty: true` offers the frame the width of contiguous unoccupied slots
to its right, stopping before another application or Master. When a frame is
absent (such as explicitly selecting volume view), it returns to the base slot. The
compositor clears previously covered slots when shrinking, and publishes the
actual rendered regions for physical touch and the web preview's hit areas.
`placement: 'last'` keeps a source after ordinary applications regardless of its
current frame. Spotify requests both options: an arriving Discord stream inserts
before it instead of cutting off its expansion. This ordering is applied to the
application list before pagination; it does not pin music onto every page.

The Spotify artwork boundary lives in `src/plugins/spotify-artwork.ts`, separate
from metadata and the pure React card. It reads the optional
[MPRIS `mpris:artUrl`](https://www.freedesktop.org/wiki/Specifications/mpris-spec/metadata/),
supports local files and HTTP(S) PNG/JPEG/WebP covers, and supplies a data URI to
the renderer. Loads run in the plugin scope in the background, with a three-second
deadline, a one-MiB body limit, two concurrent requests and eight cached covers.
Unavailable or invalid covers fall back to text; progress and audio controls do
not wait for downloads. `SpotifyArtwork` is replaceable through an Effect service.
Optional `retain` identities keep cards present while their audio streams disappear;
aliases preserve their application identity and relative order during compaction.

The studio supplies one registry to the mixer and source plugins. Register inside
the plugin activation scope: disabling unregisters the contribution and interrupts
pending rendering. The mixer owns geometry, paging and all hardware LCD writes;
the source plugin owns its metadata, React view and toggle state. Other plugins can
use this extension without claiming the LCD or adding application-specific branches
to the mixer. `src/plugins/spotify-lcd.tsx` is the working example, with the pure
React component in `src/ui/now-playing-card.tsx`. Toggle state resets on reactivation.

Physical touch and the accessible preview buttons invoke the same mixer API. Web
requests include the displayed application, dial and page, so a delayed click cannot
target another application after paging or reassignment. Swipes and Master remain
under mixer control.

## Define a feature using a Layer

`Plugin.fromLayer` builds the supplied Layer **inside the activation scope**.
This keeps its resources alive until disable; providing a resource Layer around
an effect that merely returns its API would close those resources too early.

```ts
const plugin = Plugin.fromLayer({
  id: 'my-feature',
  name: 'My feature',
  description: 'What this feature does.',
  controls: { keys: [0], dials: [0], lcds: [0] },
  service: MyFeature,
  layer: MyFeature.layer.pipe(Layer.provide(MySource.layer)),
  run: (feature) => feature.run,
});
```

The service API, errors and dependencies are inferred. `controls` may instead be
computed from actual device geometry; `supported(deck)` supplies a capability
check. For a small script, `Plugin.define({ ...metadata, setup })` accepts an
Effect returning `{ api, run? }` directly. Use `Layer.build` inside `setup` for
additional scoped Layers. Register plugins outside their own setup effects.

Each plugin's `StreamDeck` subscription receives only its declared hardware
controls. Independent subscribers remain broadcasts. `Bindings.start` handles
button/knob/touch routing and feedback in those controls. The host retains global
brightness/reset ownership. Claims prevent accidental conflicting writes; local
plugin code executes with the same OS privileges as the application.

## Bind gestures and actions

Business actions don't recognize input, schedule timers or know about the editor.
`Bindings` routes controls; `press-gestures.ts` recognizes presses. Keys and
encoders share `onShortPress`, `onLongPress` and `onDoubleTap`, and can bind all
three at once. `onPress` is an immediate down callback independent of the
semantic gestures. `onRelease` remains a raw release callback.

```ts
const binding =
  yield *
  Bindings.start({
    buttons: {
      0: {
        onShortPress: Plugin.handler(increase, feature, { amount: 1 }),
        onLongPress: Plugin.handler(increase, feature, { amount: 10 }),
        onDoubleTap: Plugin.handler(increase, feature, { amount: 100 }),
        longPressMs: 700,
        doubleTapMs: 300,
      },
    },
    knobs: {
      0: {
        onShortPress: Plugin.handler(increase, feature), // action defaults
        onRotate: Plugin.mapHandler(increase, feature, (event: DialRotate) => ({
          amount: event.delta,
        })),
      },
    },
    touch: { 0: { onSwipe: Plugin.handler(increase, feature, { amount: 100 }) } },
  });
// Return { api: feature, run: binding.run } from plugin setup.
```

`Plugin.handler` uses static parameters; `Plugin.mapHandler` derives parameters
from the typed event. Both preserve the action's encoded parameter types,
errors and dependencies, validate through its Schema, and run as supervised background
tasks. They can be assigned to key, dial and touch handlers. `Bindings.background`
does the same for a plain Effect or callback that isn't a catalogue action.
Ordinary handlers stay sequential, so small state changes keep their input order.
Background handlers explicitly allow overlap; serialize or debounce a feature's
commands in its service when its transport needs that.

Short fires on release. With a double handler, short waits until the double tap
window expires (350 ms by default). Double fires on the second release; a long
press fires once while held (600 ms by default) and suppresses short/double for
that press. Both releases must fit within the double window following the first
release. A second press held to the long threshold consumes the first pending
tap. Long intervals accept integer milliseconds from 100 to 10000, and double
intervals from 100 to 1000. The persisted `trigger + onPress` mode remains
available for a single chosen gesture; combining it with semantic handlers is
rejected rather than giving ambiguous behavior.

Every press handler receives the original event plus `gesture` and `released`.
A `hold` action bound using `Plugin.handler` receives `released` automatically;
bind it to `onPress` or `onLongPress`. Completed short/double/touch events cannot
start a hold action. Release still reaches its original invocation after page
navigation. Cancel and scope shutdown also release held inputs; stopping a plugin
interrupts background tasks and runs their finalizers. Recover action errors
deliberately in the feature if they shouldn't stop its runner.

The [executable gesture example](../packages/streamdeck/src/scripts/gesture-playground.ts)
declares two actions once and reuses them on keys, encoders and touch. Its hold
only logs; it never opens a microphone. Run it with `pnpm cli gestures --mock
--duration 3` from the Stream Deck package.

For a custom event source, use `Sources.callback`/`Sources.poll` or any Effect
Stream. A source of raw down/up events can feed `Gestures.make().down/up/cancel`
directly: its channel string is independent of HID, and identity/context isolate
sources and obsolete bindings. Race source consumption with `gestures.failure`
in the same scope. A source already providing semantic events can directly use
`Plugin.listen(source, handler)` without recognizing them again. Reuse the same
declared action for any domain event, including sources that have no device:

```ts
yield *
  Plugin.listen(
    myStream,
    Plugin.mapHandler(increase, feature, (event: { amount: number }) => ({ amount: event.amount })),
  );
```

Source errors cancel outstanding actions and run their finalizers. Background
action errors also fail the source consumer, including when an action completed
before the finite source ended. A static `Plugin.handler` accepts any event type.

| Module               | Responsibility                                                                     |
| -------------------- | ---------------------------------------------------------------------------------- |
| `press-trigger.ts`   | Serializable trigger Schema, timing ranges and defaults; also used by the browser. |
| `press-gestures.ts`  | Input-independent press state, arbitration, scoped timers and release signals.     |
| `task-runner.ts`     | Supervised background actions, failure propagation and task scopes.                |
| `bindings.ts`        | Device control validation, event routing, page ownership and initial feedback.     |
| `plugin.ts`          | Layer/definition/action API and typed action-to-handler adapters.                  |
| `plugin-host.ts`     | Activation scopes, control claims, source/task lifetime and action catalogue.      |
| `studio-input.ts`    | Web/physical source isolation and captured address/revision adapter.               |
| `studio-actions.tsx` | Persisted shortcut/layout orchestration, jobs and action feedback.                 |

The studio uses the same gesture engine, with one recognition pass per input.
Its editor currently chooses one gesture per saved shortcut; composing several
different gesture actions is available in the scripting/plugin API.

## Render a React view

`DeckDisplay.layer` uses the studio’s shared Takumi renderer with the bundled fonts, or constructs a fallback in standalone scripts.
Inside a plugin, build that Layer and use `key(index, element)`, `lcd(index,
element)` or `region(index, { x, y, width, height }, element)`. Key/LCD dimensions
come from the claimed device; preview and physical feedback use the same pixels.
An old activation cannot draw after disable, including after a later re-enable.

Keep the React component pure and consume events in the Effect service. For
example, `src/plugins/event-display.tsx` combines an external Stream with physical
press events, updates a Ref and renders one key sequentially. Hooks/DOM interaction
belong to the browser editor; hardware feedback remains raster images and HID
reports. The mixer keeps its existing partial-region cache and gesture batching.

## Current scope

This is an in-process TypeScript/Effect plugin API with runtime activation and
saved preferences. Personal plugins are registered in source and edited with
Node watch; external Elgato `.sdPlugin` bundles and SDK WebSocket clients need
an adapter. The editor configures both the existing shortcut catalogue and declared plugin actions. Custom plugin services also expose their typed scripting API.

## Declare actions once, configure them in the editor

Add actions to `Plugin.define` or `Plugin.fromLayer`. Their Schema drives decoded
parameter types, validation and the generated browser form:

```ts
const increase = Plugin.action({
  id: 'increase',
  name: 'Increase',
  description: 'Add to the feature counter.',
  input: Schema.Struct({ amount: Schema.Int.annotate({ title: 'Amount' }) }),
  defaults: { amount: 1 },
  run: (feature: MyFeatureApi, { amount }) => feature.increase(amount),
});
// In the plugin definition: actions: [increase]
```

Select **Action d’un plugin** on any key, then choose its plugin and action.
Scalar strings/numbers, booleans and literal choices become typed controls;
arrays/structured values use a JSON editor. Nested schemas and references retain
JSON fallback. Backend validation remains authoritative, including custom checks.
Actions can be saved while their plugin is disabled; enable it to execute them.
Invalid input is rejected before saving or executing. Results appear in the key
inspector. The optional third callback argument has `output(text)` for streaming
feedback. Cancelling the key or disabling its plugin interrupts scoped work.
A disabled target ends the shortcut with visible feedback instead of keeping it
in a running state.

The built-in mixer exposes page navigation and refresh. **Applications et
scripts** exposes CLI/app launches; existing launch-app/run-command shortcuts
use that same service while keeping their saved bindings and familiar fields.
It owns no physical controls, so it can run alongside the key and LCD plugins.
Disabling it cancels its command processes; other key actions remain usable.

OBS and Discord integrations, screen-share bridges and held voice actions are
described in [Application plugins](streamdeck-integrations.md). These optional
features are registered disabled; each owns its application's services, while
Raccourcis owns the keys. No-input actions can use `Plugin.NoInput`. A held action
declares `interaction: 'hold'` and receives `context.released`; application cleanup
belongs in its scoped finalizer, so disable/cancel/shutdown also stop it.

## A source-to-view plugin in a few lines

```tsx
import * as SourceView from '../plugins/source-view.ts';

const status = SourceView.key(0, {
  id: 'status',
  name: 'Status',
  source: Sources.poll(readStatus, '1 second'),
  view: (state, size) => (
    <div style={{ width: size.width, height: size.height, color: '#e2e3e8' }}>{state.title}</div>
  ),
});
yield * host.install(status);
```

`SourceView.lcd` works similarly. The typed API exposes the latest received state
as an Option. `DeckDisplay.watchKey/watchLcd` can also be used inside a larger
feature. Visual sources buffer only their latest pending frame and default to
40 ms between frames; pass `frameMillis` to tune it. This coalesces replaceable
visual state. Use `Plugin.listen` for commands/gestures where every event matters.
Repeated identical key/LCD frames are not sent over USB. Region writes invalidate
whole-LCD frame deduplication, so a subsequent full redraw stays correct.

The session renderer has a 64-entry / 8 MiB image-buffer cache, a serialized native
renderer, immutable cache copies and `stats` for local diagnosis. The studio’s
`rendererStats` exposes renders/hits/cache usage. Schema/action catalogues refresh
on a new server session. Shared backend HMR reloads wait for Vite’s readiness
reconnection, while browser-only modules keep normal updates.

## Live action feedback

An action can expose cached service state independently of its execution:

```ts
Plugin.action({
  id: 'mute',
  name: 'Mute',
  description: 'Toggle application mute.',
  input: Plugin.NoInput,
  defaults: {},
  run: (api: AudioController) => api.toggleMute,
  feedback: (api) =>
    Effect.map(api.state, (state) => ({
      text: state.muted ? 'COUPÉ' : 'ACTIF',
      tone: state.muted ? 'danger' : 'positive',
      icon: 'microphone',
    })),
  unavailable: { text: 'HORS LIGNE', tone: 'neutral', icon: 'microphone' },
});
```

`feedback` uses the same decoded Schema input as `run`, executes in the current
plugin activation scope, and returns `KeyFeedback` (`text`, `tone`, `icon`).
Keep it a cheap read of cached state; connect external events or polling in the
service Layer/run fiber. The shortcut host refreshes visible plugin bindings every
250 ms, validates feedback and coalesces unchanged rendered frames. Disabled,
failed or unavailable services show the declared fallback. The same `KeyCard`
React component drives physical pixels and web preview.

## Contextual key overlays

`DeckOverlays` is an Effect service supplied by the plugin host, scoped to the
plugin's identity. `open(id, initial)` returns a presentation with `update(overlay)`
and `close`. Create the handle during setup so it lives until the plugin is disabled;
opening one in a single action's temporary scope deliberately closes it when that
action finishes. A closed handle cannot resurrect itself or remove a newer one.

An overlay has a name, optional integer priority and a map of physical key indices
to normal `ButtonBinding` values. Missing keys pass through; `null` explicitly
blanks a key and blocks the action underneath. List every key (including nulls) to
replace the whole deck. Regions that do not overlap stay independent. Higher
priority wins per key; ties go to the most recently activated presentation. Updating
an already active presentation does not steal priority. Repeated equal source
values do not invalidate input or repaint. `update(null)` suspends the presentation;
reactivating puts it on top of equal-priority presentations.

Studio resolves the visible bindings once for its key images, browser snapshots
and gesture routing. Context changes invalidate old addresses and pending semantic
gestures cannot execute a hidden action. Releases still reach an action already
started on the original key. Base folders, pages, counters and saved configuration
survive context changes. Temporary keys cannot be edited or dragged into the base
profile; their inspector identifies the owning plugin. A local unsaved profile
shows the base configuration while editing; audio controls remain live.

The first implementation covers key layouts. LCD scenes, tactile regions and
encoder reassignment still use their current owners; this API does not bypass
those display/control boundaries.

### Change layout with the focused application

`system-control/Desktop.focused` exposes the current focused window; `focusChanges`
is a Stream of success/failure snapshots from the same shared desktop monitor.
The niri backend reads `is_focused` every second. It never focuses an application
as a side effect of observation. Another compositor can supply `DesktopBackend`.

Install a configured plugin in `src/studio-plugins.ts`, then enable its row in
**Plugins**. For example, this explicitly replaces only the final two keys of a
36-key deck while Discord is focused, using existing Discord actions:

```ts
import * as ContextLayout from './plugins/context-layout.ts';

yield *
  host.install(
    ContextLayout.plugin([
      {
        applications: ['discord'],
        overlay: {
          name: 'Discord',
          priority: 10,
          keys: {
            34: {
              action: 'plugin',
              label: 'Mute Discord',
              parameters: { plugin: 'discord', command: 'mute', input: {} },
            },
            35: {
              action: 'plugin',
              label: 'Deafen Discord',
              parameters: { plugin: 'discord', command: 'deafen', input: {} },
            },
          },
        },
      },
    ]),
  );
```

App IDs match exactly, ignoring case. This rule returns to the previous layout
when focus leaves Discord. A desktop monitoring error clears the overlay; recovery
can activate it again. Discord actions still require the Discord plugin and its
connection. No context rules or call-control commands are enabled implicitly.

### Use any event source

`ContextLayout.fromSource({ id, name, source, select })` installs a plugin from any
Effect Stream and a pure selector returning an overlay or `null`. Inside a richer
plugin's setup, `yield* Plugin.presentFrom(id, source, effectfulSelector)` returns
the supervised `run` effect. The source may be a system service, game state,
notification or HTTP/MCP-driven state. There is no browser or USB dependency in the
selector. Failure, interruption and plugin disable release its presentation through
Effect Scope; a finite source keeps its last selection until disable.

## Transform selected text with OpenAI

The existing **ChatGPT / Codex** plugin exports **Traduire · EN**, **Corriger** and
**Transformer** tiles alongside its launch actions. Drag a tile onto a key, edit its
multiline **Prompt**, then click **Enregistrer**. Preparing or saving a tile never
reads the selection, calls a model or sends keyboard input.

To use it, select text **in an editable field**, keep that window and selection
active, then press the physical key. The result replaces the selection through
Ctrl+V; no Return is synthesized, including for multiline results. The transformed
text is also the new clipboard content. Keep the target selection untouched during
generation. If the window or primary selection changes, the action refuses to paste.
A browser click on Studio changes focus: configure there, use the physical key in
the target application. Read-only text, password fields, terminals with alternate
paste shortcuts, and applications that do not export Wayland primary selection
are not supported by this adapter. Window/primary checks cannot detect every caret
move inside the same window; the target field must stay selected until replacement.

This first backend uses the authenticated **Codex CLI**, with `gpt-6-luna` and low
reasoning effort for short transformations. Optional environment overrides are
`STREAMDECK_CODEX_MODEL` and `STREAMDECK_CODEX_COMMAND`; login is owned by Codex
(`codex login status`). It uses the account's Codex allowance. This does not reuse
the Dot microphone bridge or a ChatGPT conversation. No API key or OAuth token is
stored in the key profile. The selected text and prompt are sent to the model only
when the action is invoked. Codex runs in an ephemeral empty working directory,
with structured output, no shell/plugins/apps/web tools and all discovered MCP
servers disabled for that invocation. Temporary response/instruction files and
child processes belong to Effect scopes; no detached Codex daemon is launched.
The Wayland clipboard publisher is foreground and managed by the plugin's scope,
and exits when clipboard ownership changes or the plugin/server stops.

`system-control/TextTransform` is independent of USB and accepts an injected
`TextModel`. `system-control/TextSelection` combines it with an injected
`SelectionBackend`; `wayland()` separates focus/selection checks from process I/O.
A single in-flight action is allowed, with immediate rejection of additional presses.
Cancellation/disable stops generation and prevents later replacement. Errors and empty
responses preserve the selected text; logs and inspector output contain status only.
Other interfaces can consume the same services, including another model backend.

Official references: [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
and [available models](https://learn.chatgpt.com/docs/models).
