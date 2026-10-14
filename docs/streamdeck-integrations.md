# Application plugins

The studio registers OBS, Discord, Discord screen sharing and Dot push-to-talk.
They start disabled and own no physical controls. Choose **Action d’un plugin**
on a shortcut, select its feature/action and save it. Enable its feature once the
corresponding connection is configured. Enabling establishes services; it does
not start recording, streaming, screen sharing or microphone capture.

## OBS Studio

`packages/streamdeck/src/plugins/obs.ts` implements [obs-websocket 5](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md)
through Effect's Socket and Crypto services: Hello/Identify/Identified, SHA-256
challenge authentication, correlated requests, bounded timeouts and scoped close.
It exposes status, record/stream toggles, virtual camera, save replay, scene
selection and input mute. Only explicit action execution sends these commands.
The read-only status action is the first real connection check to use.

Enable OBS's WebSocket server in **Tools → WebSocket Server Settings**. Connection
configuration belongs to the studio process environment:

- `STREAMDECK_OBS_URL`: defaults to `ws://127.0.0.1:4455`.
- `STREAMDECK_OBS_PASSWORD`: WebSocket server password, if authentication is enabled.

Passwords use Effect `Config.Redacted`, are absent from action schemas, previews
and saved profiles, and are never included in diagnostic messages. No OBS settings
were changed during implementation. OBS was installed but port 4455 was not listening;
the authenticated protocol was tested against a separate real loopback WebSocket
server, with read-only requests and a refused request. A disconnect fails pending
requests and the plugin; re-enable it after restoring the server. Requests are not
automatically retried, since repeating a toggle would reverse it.

## Discord voice controls

`src/plugins/discord.ts` now defaults to the [documented local RPC](https://docs.discord.com/developers/topics/rpc)
backend, using native IPC through Effect platform's `NodeSocket.makeNet`.
No focus changes or keyboard events are needed. The deprecated WebSocket RPC
transport is reserved for old private-beta participants; it is no longer used.

The official [Elgato authorization flow](https://help.elgato.com/hc/en-us/articles/4422740578189-Elgato-Stream-Deck-Pedal-Discord-Plugin-Setup)
ships its own integration: users press an action and authorize it in Discord.
Elgato does not document its private application credentials or RPC approval
arrangements. Our personal integration needs its own developer application;
Discord restricts unapproved RPC applications to approved testers.

### Connect from the studio

1. Open **Fonctionnalités → Connexion Discord** at `http://127.0.0.1:3900`.
2. Create an application in the linked Discord Developer Portal. Make sure your
   account has RPC tester access or the application has Discord approval.
3. Copy **Application ID** and **OAuth2 → Client secret** into the local form,
   then choose **Enregistrer l’application**. Never send the secret in chat.
4. Keep Discord Desktop open and choose **Autoriser dans Discord**. Approve the
   Discord dialog yourself. The studio sends `AUTHORIZE` with `rpc` and `identify`,
   exchanges the returned code for tokens and enables the plugin.

The private `<profile>.discord-connection.json` file uses mode `0600`, atomic
writes and a Git ignore rule. No secret/token is returned in HTTP snapshots,
SSE, action schemas or profiles. Refresh tokens renew an expiring access token
when activating a connection. Replacing application settings invalidates the
saved authorization. The form separates saved authorization from an active
RPC connection; reconnecting may still fail if Discord is closed or access revoked.
Origin/header guards protect both configuration and authorization endpoints.

For scripts without the studio, existing environment configuration is supported:

- `STREAMDECK_DISCORD_CLIENT_ID`: your application's ID.
- `STREAMDECK_DISCORD_ACCESS_TOKEN`: RPC OAuth access token, `Config.Redacted`.
- `STREAMDECK_DISCORD_IPC_PATH`: optional exact local socket path, for example a
  sandboxed Discord installation. Otherwise discovery follows Discord's documented
  runtime/temp directory order and tries `discord-ipc-0` through `discord-ipc-9`.

A bot token or personal Discord session token is not an RPC OAuth access token.
The old `STREAMDECK_DISCORD_PORT` setting is unnecessary with IPC.

The plugin authenticates, subscribes to `VOICE_SETTINGS_UPDATE` and reads
`GET_VOICE_SETTINGS`. Serialized toggles change only the requested `mute`/`deaf`
field and read back actual state. External Discord changes update the cache in
frame order; a read-only two-second poll handles missing/partial events. The
shortcut host checks cached feedback every 250 ms and writes USB pixels only
when the rendered state changes. Microphone/headphone icons and explicit
**ACTIF**, **COUPÉ** or **HORS LIGNE** labels appear on the physical key and web
preview. Deafen also marks microphone feedback as muted. No state is inferred
from button presses.

Discord documents exclusive control for `SET_VOICE_SETTINGS`, and restoration
of preceding voice settings on RPC disconnect. Disabling/restarting the plugin
can therefore restore those settings; keep this in mind during a real voice test.
The real deck binding **Mute Discord** on key 36 is preserved. Authenticated
RPC remains unverified until Manuel supplies his application and authorizes it.
Tests use fake voice state plus a real temporary Unix socket, without accessing
Discord or enabling a microphone.

The previously validated niri/wtype backend remains explicitly selectable with
`STREAMDECK_DISCORD_BACKEND=keyboard`; legacy `auto` is also supported. It briefly
focuses Discord, sends its documented shortcut and restores focus. It cannot read
voice state, so its feedback remains **HORS LIGNE**, never a guessed mute state.

There is no screen-share operation in the documented RPC command catalogue.
The separate **Discord · partage d’écran** plugin therefore uses an explicitly
configured local bridge, rather than inventing a Discord RPC method:

```sh
export STREAMDECK_DISCORD_SCREEN_SHARE='["/absolute/path/to/your-discord-bridge","share-screen"]'
```

The bridge is your script/program that implements the operation or opens its
selection dialog. It must return promptly. The deck does not click a consent
dialog or select what to share. Without configuration, enabling explains what
is missing. There is no shipped implementation of that application-specific bridge.

## Dot push-to-talk

`src/plugins/push-to-talk.ts` defines `VoiceTarget` with `start` and `stop` Effects.
Its plugin receives the Layer explicitly, so a native client API can replace a
command bridge without changing bindings:

```ts
import { Layer } from 'effect';
import * as Talk from '../plugins/push-to-talk.ts';

// dot.begin / dot.end are your already-connected application's Effects.
const target = Layer.succeed(Talk.VoiceTarget, {
  start: dot.begin,
  stop: dot.end,
});
yield* host.install(Talk.plugin(target));
```

The default registration uses `VoiceTarget.commandLayer`, configured with two
literal argv arrays: `STREAMDECK_DOT_START` and `STREAMDECK_DOT_STOP`. Both are
required. Setup resolves commands but never runs them. A bridge command has a
five-second limit and scoped subprocess cleanup; it must control the external
application and exit promptly, rather than remain as a microphone capture process.
The existing Codex Dot voice UI is not connected by this bridge automatically.
Its actual supported control interface still needs to be identified.

The action declares `interaction: 'hold'`. Its invocation receives
`context.released`, which completes on the original physical key's release, even
after paging or folder navigation. Cleanup is registered before start, and stop
runs after release, cancel, plugin/shortcut disable, shutdown or partial start
failure. A stop failure is reported, not presented as successful completion.
A two-minute safety deadline also ends an abandoned hold.

The browser test button accepts pointer/touch and Space/Enter down/up events;
blur, hidden-tab and component cleanup request release. Press/release HTTP calls
are serialized. An original slot address prevents a stale browser release from
ending a different binding. The release endpoint has the same origin and mutation
guards as the other studio endpoints. If the server cannot be reached, external
stop cannot be guaranteed before the deadline or host cleanup.

No microphone capture was enabled in verification. The browser test used two
temporary `printf` bridges and a separate mock profile; it confirmed the keyboard
press/release path and **Relâché.** output. The real deck's profile was preserved.

## Building more plugins

Use a Context service for the application's API, with an Effect Layer that owns
its connection and resources. `Plugin.fromLayer` owns its activation scope;
`Plugin.action` declares schemas and dispatches through the current service.
`Plugin.NoInput` declares an action with no parameters and no empty JSON form.
`interaction: 'hold'` exposes release; ordinary actions default to `press`.
For a long held operation, register an application stop finalizer before starting.

`JsonSocket` is the test/transport seam for JSON WebSocket protocols. Each protocol
handles its own authentication and message routing. Pending requests are bounded
to 64, expire after five seconds and are removed on cancellation. Keep secrets in
the service Layer, not in action defaults. Use `Sources.callback` or native Streams
for notifications; use `DeckDisplay` / `SourceView` for their React feedback.

Validation: 97 Stream Deck tests and 22 keep-awake tests; both package type checks.
The added suite covers a real loopback OBS transport/authentication, failure and
correlation, Discord state toggles, strict parameter-free actions, physical release
after paging, stale web release, disable cleanup, partial starts, failed stops and
literal command bridge setup/execution. No new dependencies or global settings.
The local Discord suite covers explicit legacy selection without OAuth, both shortcut
chords, missing-window/focus guards, focus restoration after failure/cancel,
user focus changes and domain error display without FiberFailure stack traces.

The RPC feedback and connection suites additionally cover external state changes,
unchanged-frame USB suppression, disable/disconnect feedback, scoped authorization,
fragmented/coalesced IPC frames, handshake/PING/PONG on a real Unix socket,
oversized-frame rejection, private file mode/persistence, token refresh and
secret-free public state/errors. HTTP tests reject cross-origin connection writes
and authorization and check sanitized schema errors. No real Discord OAuth call
or voice-setting change was made during these tests.
