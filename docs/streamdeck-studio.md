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
60 passing tests, including exact preview pixels, partial LCD composition,
persist/reload, physical and web dispatch, immediate down/up state, literal
arguments, process output and failure feedback, cross-origin rejection, invalid
configuration, duplicate-run guards, cancellation and owner-scope cleanup.
Navigation tests also cover exact legacy backup/migration, nested folders and
cycle rejection, independent zone pages, fixed navigation buttons, stale slot
addresses, physical LCD pagination with pinned Master, hidden command completion,
empty-page behavior when pinning a shortcut, and folder capacity guards that
preserve both Return and a content slot.
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

The in-app browser can land on a connection error when its Vite reload races a
Node watch restart after shared TypeScript edits. The backend recovers; reopening
the localhost page restores the editor. This development friction is tracked as
papercut `p_c81bdc5370`; it does not affect the verified hardware navigation.

## Current boundaries

One saved profile, seven built-in actions, nested folders, independent key zones,
fixed shortcuts and pagination of either key content or the existing LCD mixer.
Dial/touch rebinding, custom icon picking, profile switching, context rules and
Elgato-compatible plugin hosting remain later increments. The desktop catalogue
reads `.desktop` files in standard XDG application directories at startup.
External launches are reported by their launch command's exit status; the editor
does not claim to supervise an application's later lifetime. Unknown pre-existing
key images cannot be read back from HID.

Personal bindings in `.studio/` are excluded from the commit. No push, merge,
global Nix/USB permission change or Formula production change was performed.
