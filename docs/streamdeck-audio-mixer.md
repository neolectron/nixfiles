# Effect audio mixer — 13 October 2026

Implemented in the isolated clone `task-11/nixfiles-streamdeck`, on the existing
`feat/streamdeck-usb-hello` branch. The main checkout and original preparation
remain untouched. This builds on the Effect v4 rewrite commit `60649be9`.

## Behavior

`pnpm streamdeck mixer` displays playback applications above the available dials.
Rotation changes that application's output volume; a click toggles playback mute.
The LCD shows the app name, percentage, gauge and red `MUTED` feedback. More apps
are accessible by swiping the LCD left/right. Apps retain their slots when other
apps appear or disappear. The tested + XL has six dials and a 1200×100 strip;
regions derive from actual knob geometry, rather than assuming four equal zones.

The mixer groups an application's playback streams, preserves channel balance
and relative stream levels, caps normal volume at 100%, and does not unmute on
rotation. Existing volume above 100% may be reduced but cannot be increased.
Streams that disappear or change identity are revalidated before commands.
The process polls every 500 ms; actions are coalesced every 40 ms. Offline audio
shows amber feedback and retries on the next poll. USB disconnect requires restart.

## Implementation and sources

- [Audio service](../packages/streamdeck/src/audio.ts): typed playback snapshots,
  application grouping, serialized app changes and a testable process boundary.
  `pactl` runs with literal argv through Effect's `ChildProcessSpawner`, scoped
  resource ownership and a two-second timeout. No custom process/timer runtime.
- [Mixer script](../packages/streamdeck/src/scripts/audio-mixer.ts): Effect state,
  polling, batching, rendering and `Bindings` for dials and LCD swipes.
- Effect `Command`/`Flag`/`Schema` CLI command `mixer`, with `--step`, existing
  connection/duration flags, and an entirely inert `--mock` mode for both services.
- Control bounds are exported by the HID adapter; the bitmap renderer gains `%`.
- `pactl` is provided only by the standalone development shell. PipeWire already
  exposes the Pulse protocol in this session. This is the documented compatibility
  path for existing Pulse tools, including pactl:
  [PipeWire Protocol Pulse](https://docs.pipewire.org/page_module_protocol_pulse.html).
  Per-stream volume and mute commands and multiple channel volume arguments follow
  the upstream [pactl manual](https://man.archlinux.org/man/pactl.1.en).

## Verification

- Full monorepo typecheck and build pass.
- **35 Stream Deck tests plus 22 keep-awake tests: 57 passing.** Thirteen new tests
  cover decoding/filtering/grouping, stereo balance and relative stream levels,
  coherent group mute, stale stream identities, limits/silence, invalid changes,
  stable slots, hardware geometry, startup without mutations, batching, pagination,
  offline recovery, event routing and mock CLI isolation.
- `nix flake check --no-write-lock-file` reports **all checks passed**. Existing
  warnings about nonstandard flake outputs remain. No lockfile change or activation.
- Live [USB/PipeWire log](streamdeck-audio-mixer/live.log): Stream Deck + XL on
  `/dev/hidraw8`, Discord initially 100%, Spotify initially 20%. Startup completed
  all six region writes and read the actual session without changing its audio.
  Physical clicks muted/unmuted Spotify; clockwise and counterclockwise turns
  changed it from 20% up to 54% and back. `mixer-view` records fresh PipeWire reads,
  rather than assuming requested changes succeeded. External volume changes were
  also reflected by polling. Discord stayed at 100%, unmuted, in this test.
- Manuel explicitly confirmed: **“Oui, volume et mute fonctionnent”**, covering
  perceived volume, mute/unmute and LCD feedback. Multi-page behavior is verified
  by mocks; more than six real apps were not present in this session.
- The bounded trial was deliberately stopped by SIGINT to release the device
  before opening the continuing mixer in a dedicated Ghostty terminal. The trial
  log ends with pnpm's expected nonzero wrapper report for the interrupted command;
  this is not a native USB/audio failure.

## Disk correction and preserved scope

After the disk saturation pause and Manuel's garbage collection, the standalone
shell uses `git+file` flake source filtering. The measured filtered source is
**36 MB**, compared with an earlier **662 MB** plain-path snapshot containing
`.git` and `node_modules`. The shell works with this correction; papercut
`p_1402165819` is closed. No concurrent garbage collection was performed here.

No Discord installation/configuration, PipeWire configuration, NixOS/Home Manager
activation, USB permission, master sink, capture stream or microphone change.
The only actual audio mutations followed Manuel's physical dial actions and
targeted the requested playback app. Existing temporary USB ACL remains required.
Keep-awake source, installed binary/configuration and installation GC root are
preserved. No push, merge, PR, Formula operation or project attachment claim.

Applications need a playback stream to appear; paused streams remain visible
while their nodes exist. Long labels are truncated to twelve characters. Discord
playback mute does not toggle Discord's microphone UI mute. Automatic USB
reconnect and login startup are not configured.
