# Audio: PipeWire + WirePlumber

This system uses PipeWire as the audio engine and WirePlumber as the session manager.
Config lives in `flakes/sound.nix` (services) and `hosts/frostbit/hardware/audio-UMC1820.nix`
(hardware routing).

## Why WirePlumber is required

PipeWire is only the graph engine: it moves samples between nodes and has **no policy**.
It does not decide defaults, routing, card profiles, or volume persistence. That is the
**session manager's** job, and WirePlumber is that manager (successor to the deprecated
`pipewire-media-session`). Without a session manager, apps open streams that link to
nothing — result is silence.

It is not optional on this host because:

- **UMC1820 routing** (`hosts/frostbit/hardware/audio-UMC1820.nix`) — the 18-channel
  Behringer is split into per-channel loopback nodes (AUX2 mic, AUX3 mic, speaker,
  headphones). WirePlumber enforces this routing and the channel maps.
- **Volume keys** — niri's `XF86Audio*` binds call `wpctl` (the WirePlumber CLI).
- **Noctalia widgets** — the bar Volume widget and Control Center audio card talk to
  WirePlumber.

There is no usable lightweight alternative; `pipewire-media-session` is deprecated and worse.

## The Chrome per-app volume bug

### Symptom

Adjusting Chrome's **per-app stream volume** in pwvucontrol or Noctalia snaps back to its
previous position. Intermittent: the first move sometimes sticks, then a later move reverts
to that first value.

### Root cause (confirmed empirically)

The bug is **Chrome-side**, not a config problem.

1. Chrome **tears down and recreates** its PipeWire output stream on every pause/resume
   (and seeks). Each new stream initializes at Chrome's internal volume (100%) or inherits
   the level of another currently-playing stream — PipeWire's documented "inherit volume"
   behavior for short/new streams.
2. WirePlumber's `restore-props` keys saved volumes by `media.role` first (see
   `formKey` in `scripts/node/state-stream.lua`), and Chrome tags streams
   `media.role=Music` / `Movie`. So the restore/inherit happens by role, not by
   "Google Chrome", which is why levels bleed and snap unpredictably.

The "first move sticks, then reverts" = your first drag saves under the role key, but the
next stream open restores a different saved/inherited value before the change settles.

### Why the obvious fixes don't work

- **`block-sink-volume` quirk** (pipewire-pulse `pulse.rules`) — blocks an app from changing
  the **sink** (device) volume. The problem is the **sink-input** (per-app stream) volume,
  a different path. Tried twice (a manual `~/.config` drop-in from 2026-06-09 and a NixOS
  rule); neither worked.
- **Disabling WirePlumber `restore-props`** — verified with
  `wpctl settings node.stream.restore-props false`: Chrome's stream **still** snapped back
  to 100% instantly. This proves WirePlumber is not the restorer; Chrome re-asserts the
  value itself on stream (re)creation.

### Diagnostic commands

```bash
# Find Chrome's live output stream + its volume and media.role
pw-dump | jq -r '.[] | select(.info.props["media.class"]=="Stream/Output/Audio")
  | select((.info.props["application.name"]//"")|test("Chrome";"i"))
  | {id:.id, role:(.info.props["media.role"]//"none"),
     vol:(.info.params.Props[0].channelVolumes // "n/a")}'

# Reproduce the snap-back: set the volume and watch it revert
wpctl set-volume <ID> 0.5
for i in 1 2 3 4 5; do sleep 0.4; wpctl get-volume <ID>; done

# Prove it isn't WirePlumber (still reverts with restore off)
wpctl settings --save node.stream.restore-props false
# ... retest, then put it back:
wpctl settings --save node.stream.restore-props true

# Saved per-app/role state WirePlumber persists:
cat ~/.local/state/wireplumber/stream-properties
```

Chrome's stream binary is `application.process.binary = "chrome"`; the bar streams show as
`application.name = "Google Chrome"` with role `Music` (audio) or `Movie` (video).

### Workaround options (none are clean)

No stock config makes Chrome *remember* a per-app level across its own stream recreation.

- **Stop the fight, accept 100% on resume** — `stream.rules` match on Chrome setting
  `state.restore-props = false`. Changes stick mid-session and never snap back, but a
  paused/resumed stream starts at 100% again.
- **Pin a fixed level** — give Chrome a stable per-app key and let WirePlumber restore a
  saved value on each new stream. Persists across pauses; can flicker ~1 frame on recreate.
- **Just use the page's own volume slider** (YouTube etc.) or set the level while audio is
  actively playing and avoid full pauses — the stream only resets when torn down.

Current decision: left **stock**, since every workaround has a meaningful downside.

## References

- Arch forum, Firefox/Chromium volume reset:
  <https://bbs.archlinux.org/viewtopic.php?id=311579>
- Electron PulseAudio behavior (same root cause):
  <https://github.com/electron/electron/issues/27581>
- WirePlumber settings:
  <https://pipewire.pages.freedesktop.org/wireplumber/daemon/configuration/settings.html>
- `state.restore-props=false` per-app workaround (snapcast):
  <https://github.com/badaix/snapcast/issues/1161>
