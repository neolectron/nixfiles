# Effect plugins for the Stream Deck

The USB connection, preview mirror and editor belong to the host. Each enabled
plugin gets its own scope, a declared set of controls and a revocable `StreamDeck`
service. Enabling builds its services; disabling interrupts its tasks and actions,
unsubscribes sources, closes Layer resources and clears its owned displays.
Other plugins keep running and the physical connection stays open.

## Use the built-in plugins

The editor's **Fonctionnalités** switches control **Mixer audio**, **Applications et scripts** and **Raccourcis**.
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

const script = Effect.gen(function*() {
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
const source = Sources.poll(myService.currentState, '1 second')
  .pipe(Stream.map((value) => value.title));
yield* host.install(EventDisplay.plugin(source, 0));
```

The example has React feedback and a physical press counter. It owns key index
`0` (touch 1 in the UI); **Raccourcis** owns all keys, so disable Raccourcis before
enabling the example. Mixer audio can remain enabled because it owns other
controls. `pnpm cli plugins --mock --duration 3` runs the same example independently
without HID or real audio. All entry points use Effect CLI and Node's native TS.

`Sources.poll` returns an ordinary Effect `Stream`. Apply `Stream.map`, `filter`,
`merge`, `changes`, `debounce`, or explicit retry/recovery before consumption.
`Plugin.listen(source, handler)` preserves ordering and backpressure. A finite
source can finish while the plugin remains active; a failure stops that plugin,
releases its controls and exposes the error. It can be retried by re-enabling it.

SDKs and EventEmitters can be adapted in one place:

```ts
const source = Sources.callback<string>((emit) => {
  const listener = (event: { title: string }) => { emit(event.title); };
  sdk.on('change', listener);
  return () => sdk.off('change', listener);
});
```

The callback registers when consumed and unregisters when its plugin stops.
Default capacity is 256; overflow fails visibly rather than silently losing
commands. For replaceable snapshots such as live levels, pass
`{ capacity: 1, latest: true }`. An existing HTTP/SSE, socket, MQTT or PubSub Stream
can be used directly; transport-specific dependencies belong to its own Layer.

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

## Render a React view

`DeckDisplay.layer` uses the studio’s shared Takumi renderer with the bundled fonts, or constructs a fallback in standalone scripts.
Inside a plugin, build that Layer and use `key(index, element)`, `lcd(index,
element)` or `region(index, { x, y, width, height }, element)`. Key/LCD dimensions
come from the claimed device; preview and physical feedback use the same pixels.
An old activation cannot draw after disable, including after a later re-enable.

Keep the React component pure and consume events in the Effect service. For
example, `src/plugins/event-display.ts` combines an external Stream with physical
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
  id: 'increase', name: 'Increase', description: 'Add to the feature counter.',
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

```ts
import * as SourceView from '../plugins/source-view.ts';

const status = SourceView.key(0, {
  id: 'status', name: 'Status',
  source: Sources.poll(readStatus, '1 second'),
  view: (state, size) => h('div', {
    style: { width: size.width, height: size.height, color: '#e2e3e8' },
  }, state.title),
});
yield* host.install(status);
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
  id: 'mute', name: 'Mute', description: 'Toggle application mute.',
  input: Plugin.NoInput, defaults: {},
  run: (api: AudioController) => api.toggleMute,
  feedback: (api) => Effect.map(api.state, (state) => ({
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
