# Effect plugins for the Stream Deck

The USB connection, preview mirror and editor belong to the host. Each enabled
plugin gets its own scope, a declared set of controls and a revocable `StreamDeck`
service. Enabling builds its services; disabling interrupts its tasks and actions,
unsubscribes sources, closes Layer resources and clears its owned displays.
Other plugins keep running and the physical connection stays open.

## Use the built-in plugins

The editor's **Fonctionnalités** switches control **Mixer audio** and **Raccourcis**.
Their enabled preferences are atomically saved with mode `0600` alongside the key
profile, in `<profile>.plugins.json`. Existing profiles default to both enabled.
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

`DeckDisplay.layer` provides a Takumi renderer with the existing bundled fonts.
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
an adapter. The editor configures the existing shortcut catalogue and plugin
activation; custom plugin services/actions are scripted through their typed API.
