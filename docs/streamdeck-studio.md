# First local Stream Deck editor

## Local configuration draft and explicit Save

One **Enregistrer / Annuler** control above the device owns layout and key
configuration changes. Key forms survive selection changes, including incomplete
fields. Dragging existing keys or plugin tiles, pinning, moving shortcuts, creating
or resizing zones, creating/renaming folders and adding pages only alter the local
preview. Folder, Return and key-page controls navigate that draft without sending
navigation to the physical deck. Cancel restores the committed configuration.
During a draft, action faces cannot execute unpublished bindings; the audio mixer
continues to operate. Plugin activation stays locked until the draft is settled,
while the tile catalogue remains available to configure additional keys.

`web/key-draft.ts`, `profile-draft.ts` and `use-profile-editor.ts` separate form
conversion, pure draft projection and the Effect HTTP boundary. Both the browser
draft and the existing persisted controller use `studio-layout.ts` operations.
The editor no longer calls the per-binding/organization/navigation mutation APIs.
Only an explicit Save sends `PUT /api/profile`; submitting an inspector field with
Enter does not save. The request carries the complete profile, preview navigation,
engine session and baseline profile/configuration revision. Navigation revisions
remain separate, so physical page changes do not invalidate an edited profile.

The scoped controller validates all layout references and changed action inputs
before its existing atomic file replacement and repaint. Foreign origins, stale
sessions, concurrent profile changes and active actions reject the save. Effect
structural equality compares profiles independent of JSON field order. Errors
retain the local draft; closing/reloading a dirty tab prompts before discarding it.
Drafts are held in the browser tab, rather than persisted before Save.

Verification: `pnpm check` passes **207 tests** (22 system, 163 Stream Deck,
22 keep-awake). Added regressions prove no disk/HID changes during local edits,
combined save without executing actions, invalid/stale saves with no partial
application, navigation during editing and origin/session protection. An isolated
browser configured two counters, moved one and persisted both with one Save.
Folder preview navigation and Cancel also worked. Real-deck verification prepared
and canceled a tile edit plus drag; the personal profile stayed byte-for-byte
unchanged. Desktop and narrow-screen Save controls were checked.

## Device heading and plugin sidebar — 14 October 2026

The global navbar is removed. The connection dot precedes the device name, with
its status label below the name, above the preview. The name comes from HID discovery/open metadata; an offline
canvas no longer claims to be a detected + XL. Before discovery it says Stream Deck,
then keeps the most recently detected model through a disconnection. Detection and
reconnection fixtures cover Mini, XL and + names without changing the device profile.

The right column has **Édition** and **Plugins** tabs, with arrow/Home/End keyboard
navigation. Both panels remain mounted to retain unsaved key and connection drafts.
Selecting a key/dial for editing returns to Édition. Plugin switches and collapsible
rows now live in Plugins, including the Discord configuration inputs directly inside
its row. Closed rows retain their activation switch; a dirty key draft blocks plugin
changes until it is saved or canceled. Plugin activation is distinct from transport
health: Discord's configuration shows its saved authorization, not an inferred RPC
connection just because the plugin is enabled.

Each plugin row separates **Tiles** and **Réglages** into its own keyboard-accessible
tabs, preserving connection drafts across tab switches. Exported tiles use the same
`KeyCard` renderer as the deck, scaled to 68 px, and remain visible with their plugin
disabled. Click a tile to prepare an assignment on the selected key, or drag its
six-dot handle onto an editable key. The target highlights during dragging and
Édition opens with an unsaved draft after dropping. **Enregistrer** commits the
assignment; palette gestures never invoke plugin actions. Escape, pointer cancel
and window blur cancel dragging. Existing deck rearrangement remains independent.

Verification: `pnpm check` passes **203 tests**. Live browser checks cover category
isolation, keyboard tab navigation, an OBS tile dropped onto an empty key while
OBS is disabled, canceling that draft, and the narrow-screen layout.

## Dial interaction and visible rearrangement handles — 14 October 2026

Snapshots now carry cumulative signed `rotationSteps` for each encoder. Immediate
input snapshots update the web rotor with a 120 ms transform transition, including
at gain limits and on unassigned dials. Positive cranks rotate clockwise; negative
cranks rotate counterclockwise. No angle is inferred from volume or from event text.
Reduced-motion mode preserves the orientation change without interpolation.

The browser adapter converts horizontal displacement, wheel movement and
left/right arrow keys into `DialRotate` events through Effect HTTP and the shared
event source. Drag right / wheel up increases volume; drag left / wheel down
decreases it. A drag does not select the dial. Queued gestures retain their session,
application and page identity; stale requests fail with 409, and the mixer also
revalidates the target when routing a queued event. Master remains pinned.

Each movable key has a numbered, six-point button extending slightly over its
top edge, with grab/grabbing cursors and keyboard focus. It is a sibling of the
action face and edit button, so dragging never begins a press gesture. A narrow
viewport scrolls the key grid locally instead of clipping the handles. The face
continues to support short press, double tap and long press through the library.

Verification: `pnpm check` passes **194 tests** (18 system, 154 deck, 22 keep-awake).
New tests cover signed physical rotation beyond Master’s 150% ceiling, independent
pressed state, the generic plugin event path, HTTP validation, foreign origins
and stale targets. In an isolated virtual Studio, a long-press counter moved from
key 9 to key 2 without incrementing; holding its face then incremented it once.
Dragging the first demo dial 60 px right changed 20% to 40% and its rotor to 150°;
dragging 30 px left decreased it, and wheel up increased it. Physical mock events
also updated that same rotor. The real Studio remains on port 3900; browser
inspection found no console warnings/errors, including wheel handling.

Implemented in the isolated `task-11/nixfiles-streamdeck` checkout on
`feat/streamdeck-usb-hello`. The user's main checkout and keep-awake integration
remain untouched. This increment follows the approved preview/select/configure
workflow and prioritizes application launch and scripts, because audio mute is
already assigned to dial presses.

## Browser input and optional hardware

Studio now starts and keeps its real plugins running without USB. `DeckConnection`
is the Effect service owning native acquisition, scoped closure and reconnecting
once per second. `use` fails with a typed `DeckOffline`; callers choose their own
handling. The separate `studio-device.ts` boundary handles that expected error to
retain a virtual canvas and replays cached images and brightness before physical
inputs resume. Metadata reads still fail while offline. The header distinguishes
hardware disconnection from loss of the web server. This established profile uses
`Stream Deck + XL` capabilities when starting offline; detected hardware supplies
capabilities when available. A different model requires restarting with that device
selected.

Left mouse and keyboard presses execute the key's saved gesture. Pointer down/up,
cancel, blur and hidden-tab cleanup share `web/use-key-input.ts` with the inspector's
held test control. No gesture timing lives in React. Each adapter has its own owner,
so another tab or inspector cannot release its press. Address and layout revision
checks reject stale activation; stale release/cancel cannot clear a newer hold.
The pencil appears on hover or keyboard focus; right click edits too. Editing does
not dispatch a press. The numbered six-point button is the drag handle, avoiding action activation
while rearranging. Alt + arrows still work.

`studio-events.ts` broadcasts browser input to ordinary plugin subscriptions as
well as the preview. `Bindings` recognizes semantic gestures for those plugins,
separating owners and preserving cancellation contexts. Persisted Shortcuts use
their validated action adapter once; they ignore the mirrored web event. Physical
disconnection emits cancellation through the same library, including pending
long/double gestures, while web input continues. Tests cover offline rendering and
actions, native handle cleanup/reconnect and frame restoration, direct plugin
bindings, independent browser owners and stale cancellation.

## Spotify track view on the LCD

With Spotify enabled, tapping a Spotify/Spotifast card switches between volume
and track title, artists, elapsed/duration times and a progress bar. The source
plugin registers scoped content with `MixerCards`; the audio mixer remains the
sole LCD writer and owns paging and dial volume/mute. The browser preview invokes
the same tap API, guarded by the displayed application and page. Spotify actions
also resolve Spotifast automatically.
Rotation now immediately adds a circular volume overlay on the album artwork,
with the percentage centered. It disappears after 1.5 seconds of inactivity and
the next mixer refresh; the expanded track view stays visible throughout.
Clock-controlled tests cover renewed deadlines, independent players and explicit
touch choices; a mixer test verifies redraw before audio flush and excludes empty
dials and Master from application notifications.
The real deck test confirmed the overlay and its disappearance without shrinking
the card. The pure `ui/volume-overlay.tsx` component reuses the volume boost colors;
the plugin owns timing and the mixer remains the audio writer. Without artwork,
the overlay uses a neutral tile; narrow cards can also display it.

The real Stream Deck test confirmed both view transitions and continuing knob
volume control. Desktop and narrow browser previews were checked, including long
title truncation and transparent interactive overlays. Tests cover paused timing,
missing timing, player discovery, stream disappearance and alias retention, stale
web taps, and plugin disable during rendering. No playback command was issued by
these display tests. This change does not implement stream volume restoration.

Mixer cards compact left when an application disappears, preserving the relative
order of remaining applications and appending newly discovered ones. Page counts
and the selected page are recomputed from this compact order. A regression test
removes the first application across a page boundary and verifies that queued
volume/mute changes still target application identities after cards move; Master
remains at the right.

Music cards now stay after other application cards regardless of volume/track
mode. Their track view expands across available empty slots up to Master, with
larger text and optional album artwork. Incoming apps insert before music rather
than blocking its available width. Expansion does not assign extra knobs; physical
touch and browser hit areas cover the actual rendered card. Returning to volume
or shrinking clears previously covered slots.

The real preview showed Pearl Jam's “Alive” artwork across an 864-pixel region,
then narrowed when Discord arrived. Following that feedback, music was moved to
the end of the application order. Desktop and 390-pixel browser layouts were
checked without horizontal overflow. Tests cover expanded regions, clearing,
Master exclusion, trailing placement, touch over covered empty slots, MPRIS art
metadata, background download deduplication/limits, eviction and scope cancellation.

## Structure

- `studio-contract.ts`: shared Effect schemas for action parameters, profiles,
  API payloads, catalogue and live device snapshots.
- `studio-actions.tsx`: persisted bindings, scoped execution, cancellation and
  key feedback. Desktop applications launch through `gio launch`; commands use
  Effect's process service with literal argv and bounded captured output.
- `studio-layout.ts`: pure projections and validation for disjoint zones, nested
  folders, independent page cursors and fixed tiles. Stable shortcut IDs preserve
  running jobs and feedback through moves and navigation. Automatic Return tiles
  remain available on every folder page; cyclic folder links are rejected.
- `deck-preview.ts`: decorates the existing device, records successful RGB writes
  and composes LCD regions. PNG encoding is lazy and cached by revision; there is
  one HID owner and no second hardware subscription for the browser.
- `scripts/studio.ts`: combines the action engine and existing audio mixer, serves
  Effect HTTP routes through Vite, and broadcasts state over SSE. Key down/up
  snapshots are published immediately; slower display/audio changes are sampled
  every 150 ms. Dial down/up events use the same immediate stream and highlight
  the pressed knob. Input sequence numbers prevent stale polls from overwriting held
  keys; a per-runtime UUID resets that ordering after a watch restart.
- `src/ui/`: pure React key and volume views shared with the native renderer.
- `web/`: React preview and schema-backed inspector, Effect fetch/SSE transport,
  live draft/save/error states, stale-edit protection and command output.

Vite and fast-png are pinned dependencies. GLib is added only to the existing
standalone Nix shell for desktop application launch. Node execution now uses
`--import tsx` for shared JSX views. Explicit `.ts`/`.tsx` imports and `noEmit`
remain; no build script, barrel or `node:` import is
introduced in the package. No Elgato plugin host or OpenDeck runtime is installed.

## Verification

### Button activation gestures

Each saved shortcut has an optional `trigger`: `press` (immediate, the legacy
default), `long-press` (600 ms by default), or `double-tap` (350 ms by default).
The inspector's **Déclenchement** selector exposes all three. Long-press duration
is configurable between 100 and 10000 ms; double-tap interval between 100 and
1000 ms. Long press fires once while still held, and releasing early cancels it.
Double tap fires once on the second release: both presses must be short and the
second release must fall within the interval following the first release. A
single tap does nothing in that mode. This selects one gesture for the existing
action; it does not assign several different actions to the same physical key.

`press-gestures.ts` is shared by the scripting router and the studio, using Effect
Clock, scoped fibers, Sleep and Semaphore. Callback failures reach the router;
ordinary canceled timers do not fail the plugin. Captured identity/configuration
and layout revision prevent delayed gestures from dispatching a different action
after edits, moves or navigation (including away-and-back). Physical and web
gesture/release ownership are separate. The `/api/key-input` endpoint applies the
existing origin guard and accepts down/up/cancel with the captured slot/revision.
Browser cancellation, blur, hidden tabs and component cleanup cancel waiting
gestures and release held actions. Legacy `/api/trigger` remains an explicit
immediate action invocation for callers that intentionally bypass gestures.

An action declaring `interaction: hold` accepts simple or long press and stops
on the original key's release. Double tap is disabled in the inspector and
rejected on save for those actions. The real Dot connection remains unconfigured;
its microphone was not started during gesture testing.

Scripts use the same abstraction without adding their own timers:

```ts
yield *
  Bindings.run({
    buttons: {
      0: { trigger: { type: 'long-press', milliseconds: 800 }, onPress: myAction },
      1: { trigger: { type: 'double-tap' }, onPress: anotherAction },
    },
  });
```

The library also accepts independent `onShortPress`, `onLongPress` and
`onDoubleTap` handlers on keys and knobs, with shared arbitration and release
signals. The [plugin guide](streamdeck-plugins.md#bind-gestures-and-actions)
describes typed action bindings, supervised tasks and the responsibility split.
`studio-input.ts` adapts addresses and revisions to that engine; the shortcuts
plugin forwards raw events once, removing the former nested binding recognizer.
The browser imports the serializable Schema/defaults from `press-trigger.ts`
without pulling in the runtime timer engine.

155 Stream Deck tests and both package typechecks pass. Deterministic TestClock
tests cover boundaries, repeated down events, pair consumption, cancellation,
scope shutdown and error propagation. Mock HID/studio tests cover persistence,
page/edit invalidation, stale web cleanup and long-press push-to-talk cleanup.
An isolated mock editor verifies browser double-click and single-click behavior;
its local input API verifies held long-press dispatch and release. The real
profile's actions and trigger choices are preserved.

The key preview supports pointer dragging by the numbered six-point corner handle and Alt + arrow
keys. Pointer capture supports mouse and touch without native HTML drag/drop. Dropping
onto an occupied slot exchanges shortcuts; a free slot moves the shortcut.
The operation uses one atomic profile write, retains shortcut IDs/feedback and
checks both slot addresses and the layout revision. Unsaved drafts, held/running
actions and automatic folder Return tiles cannot be rearranged. A fixed tile can
move to a free slot in its own zone on every page; moving it to a free slot in
another zone requires unpinning it first. Occupied fixed slots keep their fixed
status during an exchange. The zones themselves retain their physical key sets.

108 Stream Deck tests and both package typechecks pass after this increment.
The real browser verified a counter move, an exchange with Spotify and an inverse
keyboard move, without executing either action; the original arrangement was
restored afterwards. The narrow viewport has no horizontal overflow. The current pointer adapter was verified in the browser with forward/inverse
moves and an unchanged action count; physical touchscreen dragging was not tested.

Type checking passes for both workspace packages. The Stream Deck suite has
90 passing tests, including exact preview pixels, partial LCD composition,
persist/reload, physical and web dispatch, immediate down/up state, literal
arguments, process output and failure feedback, cross-origin rejection, invalid
configuration, duplicate-run guards, cancellation and owner-scope cleanup.
Navigation tests also cover exact legacy backup/migration, nested folders and
cycle rejection, independent zone pages, fixed navigation buttons, stale slot
addresses, physical LCD pagination with pinned Master, hidden command completion,
empty-page behavior when pinning a shortcut, and folder capacity guards that
preserve both Return and a content slot. Targeted folder opening also works from
a single-key navigation zone into another region; invalid targets and shrinking
that region below Return + content are rejected without changing the profile.
Resize tests exchange physical slots across every root page, retaining stable
counter state and fixed controls. The browser mock test resized keys 1–9 to 1–4
(three folder icons + Return), then opened that folder into the main zone while
keeping its launcher and pinned pager visible. The real profile was not resized.
Desktop and mobile checks show the target map/capacity beside the assignment and
the visual key selector below the deck; no horizontal overflow was detected.
The 22 keep-awake tests also pass. Frozen pnpm installation and Nix flake checks
passed after the dependency changes.

On the real Stream Deck + XL (`0fd9:00c6`, 36 keys, six dials, 1200×100 LCD),
the local editor on port 3900 was used to save:

- **Terminal**: Ghostty desktop application. Testing opened a separate terminal,
  which was closed after verification.
- **Hello CLI**: `printf` with literal arguments. The inspector showed three
  output lines, including spaces and literal `$(pas un shell)` text.

Manuel confirmed that the physical key triggers the action, the web preview is
synchronized and the LCD follows dial volume changes. After that feedback, held
key indication was changed to a visible overlay above the key image, driven by
immediate physical input rather than the last-event footer. An automated test
checks both held and released snapshots for keys and dials without relying on
polling. Manuel confirmed that the key highlight follows the physical hold.

For the folder/pagination increment, the real profile was organized through the
editor: **Raccourcis** owns keys 1–9, **Outils** is on key 3 and contains Hello CLI,
and fixed **Page − / Page +** tiles on keys 10/11 target Raccourcis. Its second
page contains an inert **Page 2** counter. Terminal remains in its original root
slot. The exact previous profile is backed up inside the ignored `.studio/`
directory. Manuel confirmed the physical sequence next page, previous page,
folder, Hello CLI and Return: only the first row changes while pagination tiles
and the real LCD mixer remain in place. The mock browser also verified creation,
move, double-click folder opening, counters, targeted paging and pinning.

Desktop and 390-pixel mobile views were inspected in a real browser; mobile has
no horizontal overflow. Backend watch restarts release the HID handle and HTTP
connections before reopening. The real editor remains running in the
**Stream Deck Studio Dev** terminal; the temporary mock editor was stopped.

Shared TypeScript edits previously raced Vite reloads against Node watch shutdown.
The Vite hook now defers reloads for the shared contract/key-card modules until its
readiness reconnection; browser-only modules retain normal HMR. A real key-card
change restarted the hardware server while the existing browser tab stayed on
localhost and returned to **Connecté**, with Terminal and the mixer intact.
This resolves the observed papercut `p_c81bdc5370`.

## Current boundaries

One saved profile, built-in shortcuts and declared plugin actions, nested folders, independent key zones,
fixed shortcuts and pagination of either key content or the existing LCD mixer.
Dial/touch rebinding, custom icon picking, profile switching, context rules and
Elgato-compatible plugin hosting remain later increments. The desktop catalogue
reads `.desktop` files in standard XDG application directories at startup.
External launches are reported by their launch command's exit status; the editor
does not claim to supervise an application's later lifetime. Unknown pre-existing
key images cannot be read back from HID.

Personal bindings in `.studio/` are excluded from the commit. No push, merge,
global Nix/USB permission change or Formula production change was performed.

## Plugin consolidation

The audio mixer and shortcut router now use `PluginHost` with independent
activation scopes. `Plugin.fromLayer` keeps service resources alive through the
activation; `Plugin.define` also accepts direct Effect setup. The host checks
control conflicts, filters hardware subscriptions, cancels scoped actions,
revokes old writers, cleans up source failures and supports self-disable without
waiting on its own scope. React feedback is available through `DeckDisplay`.
`Sources.callback` provides unsubscribe + overflow semantics; polling and other
Effect Streams share `Plugin.listen`. `studio-plugins.ts` registers personal
plugins, including an inactive React/source example. Studio switches persist in
the ignored profile-adjacent `.plugins.json`, with the same origin guards as other
mutations. See [the plugin guide](streamdeck-plugins.md).

Plugin tests cover repeated activation and Layer finalizers, one USB connection,
stale display writers, conflicts, failed setup and source cleanup, callback
unsubscribe/overflow, caller/plugin-scope cancellation, independent mixer and
shortcut toggles, persisted/reloaded preferences, and self-disable. HTTP tests
cover cross-origin plugin changes and stale expected states. The existing mixer,
layout and command suites remain part of validation.

Browser evidence: real mixer activation was toggled off/on without changing
Spotify (20%) or Master (100%). In the mock editor, overlapping key ownership
was rejected explicitly, then the clock/React plugin replaced Raccourcis while
the mixer kept running. Re-enabling Raccourcis restored a saved counter through
the same browser session. Desktop and mobile inspection found no horizontal
overflow. The real editor remains on port 3900 with its original shortcuts and
all three production features enabled; the example stays disabled.

## Action and rendering consolidation

Plugin actions declare an Effect Schema once; the host validates defaults/inputs,
exports a static catalogue and dispatches each call in its plugin activation
scope. The studio projects primitive/choice fields and uses lossless JSON for
structured parameters. Persisted plugin bindings use plugin/action IDs and input,
with the same stale-address and profile guards. Existing CLI/application bindings
delegate to the Commands service/plugin, retaining literal argv, incremental
bounded stdout/stderr and process cleanup. They remain configurable and stored in
their original shape. Cancelling a command or disabling its owning plugin releases
its process without stopping the mixer or shortcut router.

The studio builds a single ReactRenderer Layer for the session. Mixer/key/source
plugins use its serialized 64-entry / 8 MiB raster cache with copied buffers;
DeckDisplay deduplicates key/full-LCD writes and invalidates full-LCD stamps on
region changes. SourceView key/LCD factories and watch helpers coalesce visual
state with a sliding pending frame and explicit timing. Command streams retain
Plugin.listen ordering/backpressure. A failed finalizer is reported while control
ownership is released. Plugin-action tests cover schema field round trips, invalid
save rejection, physical and web dispatch, disabled/long action feedback,
command cancellation, cache buffer protection, region invalidation, coalescing
and cleanup faults. Effect CLI and Node with the `tsx` runtime loader remain the entry points.

Browser validation saved a Commands plugin action, generated its parameter fields,
executed `printf` and displayed **Hello depuis Effect** in the inspector. Desktop
and 390-pixel views were inspected; the mobile page has no horizontal overflow.
The temporary mock editor was stopped, while the real editor remains on port 3900
with its original profile and real audio applications. All 77 Stream Deck tests,
22 keep-awake tests and both package type checks pass. The subsequent application
plugin increment adds seven tests (84 total) and optional OBS/Discord/voice plugins;
see [connection requirements and verification](streamdeck-integrations.md).
