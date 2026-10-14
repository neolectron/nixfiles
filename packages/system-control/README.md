# System control

Effect v4 services for Linux audio, MPRIS players, Discord RPC, desktop applications and OBS. This package has
no dependency on Stream Deck, React or the Studio. Its Layers own polling,
connections, reconnection and cleanup. Consumers never start a monitor.

Import concrete modules with `.ts` extensions; there is no barrel or build step.
Node 24 executes these TypeScript sources directly with `noEmit`. Platform I/O
uses Effect's process, socket, HTTP, filesystem, clock and crypto services.

## Use a service

```ts
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Console, Effect } from 'effect';
import { Audio, layer } from '@nixfiles/system-control/audio.ts';

const program = Effect.gen(function* () {
  const audio = yield* Audio;
  yield* Console.log(yield* audio.state);
  // Only execute these when the caller actually wants to change the system:
  // yield* audio.setVolume('spotifast', 45);
  // yield* audio.setMuted('spotifast', true);
});

NodeRuntime.runMain(program.pipe(Effect.provide(layer), Effect.provide(NodeServices.layer)));
```

The scope created by providing the Layer owns the service. Closing it stops its
background tasks and in-flight operations; canceled callers also cancel their
operations. Keep the Layer at the application root for long-lived consumers.
Do not return a service from a finished scope and then use it elsewhere.

## Current API

| Service / module            | Operations                                                                                                                                     | State                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `Audio` / `audio.ts`        | `setVolume(key, percent)`, `setMuted(key, boolean)`, `setMasterVolume(percent)`, `setMasterMuted(boolean)`, relative `change` / `changeMaster` | `state`, `snapshot`, `observe`, `refresh`; fresh compatibility reads `list`, `master`         |
| `MprisPlayer` / `mpris.ts`  | `command`, `seek`, `toggleShuffle`, `cycleLoop`; Layer takes a D-Bus name                                                                      | `state`, `snapshot`, `observe`, fresh `current`                                               |
| `Spotify` / `spotify.ts`    | Same playback operations; discovers Spotify / Spotifast, `forApplication(key)`, `applications`                                                 | `state`, `snapshot`, `observe`, fresh `current`                                               |
| `MediaPlayers` / `media.ts` | `command` selects the active controllable MPRIS player                                                                                         | `state`, `snapshot`, `observe`, fresh `current`                                               |
| `Discord` / `discord.ts`    | `set('mute' \| 'deaf', boolean)`, `toggle`, `reconnect`                                                                                        | `state` / `voice`, `snapshot`, `observe`, fresh `current`                                     |
| `Desktop` / `desktop.ts`    | `open(target)` launches an installed desktop ID or focuses its existing window; `status(target)`, `refresh`                                    | `snapshot`, `observe`, `focused`, `focusChanges`, installed `applications`; niri window state |
| `Obs` / `obs.ts`            | `request(requestType, requestData)` via obs-websocket 5                                                                                        | `state`, `snapshot`, `observe`; connected or typed unavailability                             |

`state` fails with a typed `AudioError` or `IntegrationError` when unavailable.
`snapshot` returns an Effect `Result`, and `observe` emits the current Result
followed by changes, including unavailability and recovery. Streams broadcast
to independent subscribers with a sliding buffer of 64 replaceable snapshots.
Reads of cached state do not change the system. Explicit commands are serialized
per service. App volume is bounded to 200%, Master to 150%; channel balance and
stream identities are preserved. Absolute mute applies to every current stream
of an application, including mixed mute states.

The primary APIs are the service classes and their Layers. The lower-level
protocol factories remain available for transport tests and advanced composition;
they are not the managed service API.

## Compose once

`runtime.ts` exports `integrationsLayer` (Spotify, media, Discord, Desktop) and `layer`
(also Audio). These are compositions, not re-exports. The live implementation
needs `pactl`, `busctl`, the desktop session bus and the usual Node platform services.
Desktop additionally uses `niri` and `gio`; `DesktopBackend` is replaceable on another
desktop or in tests. `Desktop.serviceLayer` consumes that boundary. Desktop state
represents windows, including exact app IDs and `StartupWMClass`, rather than guessed
process names. Discovery follows XDG precedence and never evaluates desktop `Exec`
as a shell command. Its polling fiber ends with the service scope; launched GUI apps
remain independent of that scope.

OBS is opt-in via `Obs.layer` instead of starting in the shared default runtime.
It uses `STREAMDECK_OBS_URL` (default `ws://127.0.0.1:4455`) and a redacted
`STREAMDECK_OBS_PASSWORD`. It acquires a stable API immediately, even when OBS is
offline, reconnects after a failed session with a one-second delay, and revokes
operations on scope close. Offline requests fail with `IntegrationError`; rejected
requests do not disable the service. Initialization/reconnection sends only protocol
identification, never recording, streaming or camera commands. Tests can use
`Obs.serviceLayer(options)` with a fake `JsonSocket`.
Providing the same Layer object once at a root scope shares its instances;
Effect memoization does not create a singleton between separate processes.

The Studio builds this runtime once and its presentation plugins reuse it. A
presentation plugin can be disabled without closing the shared system service.
Outside that runtime, plugins can still acquire their own scoped service.

## Discord credentials

`Discord.serviceLayer(optionsEffect)` accepts an application client ID and a
`Redacted` access token, with an injectable `DiscordTransport`. `Discord.layer`
uses an optional `DiscordConnection` service or the existing
`STREAMDECK_DISCORD_CLIENT_ID` / `STREAMDECK_DISCORD_ACCESS_TOKEN` environment
variables. Existing environment names and saved mode-0600 OAuth files remain
compatible. The `make(path)` factory in `discord-connection.ts` takes the path from its caller; the
library does not assume a Studio profile location. Authorization remains an
explicit action. Starting the service never mutes, deafens or starts sharing.

The stable service survives disconnects. IPC events update voice state; a
read-only poll recovers missed events. Failed sessions release their socket and
retry after one second. Currently configuration and protocol failures share the
typed `IntegrationError`; finer failure categories belong to the next phase.

## Inspect without USB

From the repository root:

```sh
nix-shell packages/streamdeck/shell.nix
pnpm system inspect
pnpm system inspect --discord-connection /absolute/path/to/existing-oauth.json
```

This Effect CLI prints public state or a short availability error for each
service. It does not import HID, acquire USB, change volume, send playback
commands or launch interactive authorization. The optional connection file may
refresh an already authorized OAuth token. No credentials are printed.

## Tests and next phases

`pnpm check` includes this package's Oxlint/Oxfmt, TypeScript and Vitest checks.
Tests inject `Pactl`, `MprisTransport` and `DiscordTransport`; no real playback or
account is needed. They cover external state changes, exact setters, concurrent
writes, reconnects, shared Layers, cancellation and scope cleanup, plus existing
OAuth/IPC tests.

The shared schema action catalogue, HTTP/MCP adapters, OBS/Desktop/Voice services
and SurfaceHost are subsequent stages of the
[architecture plan](../../docs/system-control-streamdeck-plan.md).
LCD tiles, artwork, gestures and navigation remain in Stream Deck presentation
code for this first migration stage.

## Text transformation and selection

`TextTransform.layer` offers `transform({ text, prompt })`; inject `TextModel` into
`TextTransform.serviceLayer` to use another backend. The default Codex adapter uses
existing CLI authentication, `gpt-6-luna`, ephemeral structured output and scoped
process/temp-file cleanup. `STREAMDECK_CODEX_MODEL` and `STREAMDECK_CODEX_COMMAND`
are optional overrides. It disables discovered MCP servers and shell/apps/plugins
for each call and never changes global Codex settings. Selected text travels through
stdin, not command arguments, profiles or logs.

`TextSelection.layer` offers `transform(prompt, output?)` for the current editable
Wayland selection. Its `serviceLayer` accepts `SelectionBackend` and `TextTransform`.
The default boundary needs `niri`, `wl-paste`, `wl-copy`, `wtype` and `codex` on PATH.
It reads PRIMARY, checks window/selection identity before replacement, then pastes
through Ctrl+V with a scoped clipboard publisher. The result stays on the clipboard.
The caller must keep the editable selection active; read-only selections and
applications without PRIMARY/conventional paste support are unsupported. It cannot
identify caret changes that do not alter PRIMARY within the same window. Calls are
serialized by rejection, never queued against a later selection. Scope closure
cancels pending work and revokes the retained API.

## System appearance

`SystemAppearance.layer` in `appearance.ts` exposes `set('dark' | 'light')`,
`toggle`, `state`, `snapshot`, `observe` and `refresh`, independently of USB.
Commands serialize against a fresh desktop read. The scoped one-second monitor
follows external preference changes, publishes typed unavailability/recovery and
stops on scope close; retained operations are revoked. Acquiring or observing the
service never changes the theme.

The default backend calls Noctalia's `darkMode.setDark` / `setLight` IPC, allowing
the shell to manage its own palette/templates, then publishes
`org.gnome.desktop.interface color-scheme` through `gsettings`. Desktop portals
expose this as `org.freedesktop.appearance/color-scheme` for applications following
the system preference. Applications with a forced theme keep that override. The
standard `default` preference resolves to light. No per-app settings or global
Nix configuration are rewritten.

`STREAMDECK_APPEARANCE_BACKEND=gsettings` selects preference-only control for a
desktop without Noctalia. Tests or other desktops can inject `AppearanceBackend`
into `SystemAppearance.serviceLayer`. This optional service is acquired by the
appearance plugin only when enabled, unless explicitly shared by its caller.
