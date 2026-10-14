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

`src/plugins/discord.ts` uses the [documented local RPC](https://docs.discord.com/developers/topics/rpc).
An authorized Discord application is required. A bot token or a personal Discord
session token is not an RPC OAuth access token and must not be substituted.
This implementation accepts an existing authorized RPC OAuth access token; it
does not implement the application's OAuth authorization/token exchange flow.

- `STREAMDECK_DISCORD_CLIENT_ID`: authorized application's ID.
- `STREAMDECK_DISCORD_ACCESS_TOKEN`: OAuth access token, held as `Config.Redacted`.
- `STREAMDECK_DISCORD_PORT`: defaults to `6463`; select the local client's actual
  port within Discord's documented `6463..6472` range.

The plugin authenticates, reads `GET_VOICE_SETTINGS`, and serializes toggles through
`SET_VOICE_SETTINGS`. It changes only the requested field (`mute` or `deaf`).
Status reads the client's state. No credentials were requested through the action
form or saved in the repository. Discord's local RPC was observed on port 6463,
but authenticated real voice control remains unverified until access is supplied.
Protocol tests replace the JsonSocket Layer; no real Discord voice settings changed.

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

Validation: 84 Stream Deck tests and 22 keep-awake tests; both package type checks.
The added suite covers a real loopback OBS transport/authentication, failure and
correlation, Discord state toggles, strict parameter-free actions, physical release
after paging, stale web release, disable cleanup, partial starts, failed stops and
literal command bridge setup/execution. No new dependencies or global settings.
