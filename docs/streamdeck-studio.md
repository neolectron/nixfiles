# First local Stream Deck editor

Implemented in the isolated `task-11/nixfiles-streamdeck` checkout on
`feat/streamdeck-usb-hello`. The user's main checkout and keep-awake integration
remain untouched. This increment follows the approved preview/select/configure
workflow and prioritizes application launch and scripts, because audio mute is
already assigned to dial presses.

## Structure

- `studio-contract.ts`: shared Effect schemas for action parameters, profiles,
  API payloads, catalogue and live device snapshots.
- `studio-actions.ts`: persisted bindings, scoped execution, cancellation and
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
standalone Nix shell for desktop application launch. Native `.ts` execution,
`.ts` imports and `noEmit` remain; no build script, barrel or `node:` import is
introduced in the package. No Elgato plugin host or OpenDeck runtime is installed.

## Verification

Type checking passes for both workspace packages. The Stream Deck suite has
84 passing tests, including exact preview pixels, partial LCD composition,
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
and cleanup faults. Effect CLI and native `.ts` execution remain the entry points.

Browser validation saved a Commands plugin action, generated its parameter fields,
executed `printf` and displayed **Hello depuis Effect** in the inspector. Desktop
and 390-pixel views were inspected; the mobile page has no horizontal overflow.
The temporary mock editor was stopped, while the real editor remains on port 3900
with its original profile and real audio applications. All 77 Stream Deck tests,
22 keep-awake tests and both package type checks pass. The subsequent application
plugin increment adds seven tests (84 total) and optional OBS/Discord/voice plugins;
see [connection requirements and verification](streamdeck-integrations.md).
