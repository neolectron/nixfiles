# Master dial — 13 October 2026

Follow-up to the working app mixer committed in `0022925d`. Implemented in the
same isolated clone on `feat/streamdeck-usb-hello`; no edits to the main checkout.

The rightmost dial is reserved for `MASTER` on every page. Rotation adjusts the
default playback output's volume; clicking toggles output mute. The other five
dials on the + XL remain for applications, with swipes changing app pages. The
master remains usable with no application streams. Its feedback is polled along
with app feedback, so external changes and default-output changes are reflected.

`Audio` exposes `master` and `changeMaster(outputSnapshot, change)` as Effects.
The existing scoped pactl adapter resolves the default sink and reads JSON sinks.
Changes target its explicit name, revalidating the default and object serial
before writing; pending gestures cannot spill onto a newly selected/recreated
output. Volume and mute share the service's serialization lane with app actions.
Channel balance, 0–100% normal limits, existing amplification limits and mute on
rotation follow the existing app-volume behavior. No source/microphone commands.
The commands follow the upstream
[pactl manual](https://man.archlinux.org/man/pactl.1.en): `get-default-sink`,
`list sinks`, `set-sink-volume` and `set-sink-mute`.

Automated verification: **39 Stream Deck tests passing**, plus typecheck and
build. Four new regressions cover master channel balance/mute with untouched app
volumes, default-output replacement/recreation/disappearance, fixed rightmost
routing across pages and master failure independent of app control. The existing
pagination regression now uses five app slots. The mock CLI remains inert for
both app and master audio. Keep-awake code and all Nix configuration/dependencies
remain unchanged; their checks passed in the preceding mixer task.

Live startup on `/dev/hidraw8` completed all six regions: Discord 100%, Spotify
20%, MASTER 100% unmuted. The default sink was `headphones_input`, serial `51`,
with both channels at 65536. Startup only read this state. The previous mixer was
stopped with SIGINT, then the new version opened in the dedicated Ghostty terminal
`Stream Deck Audio Mixer`; Ctrl+C stops it. No permission, configuration or default
device change was made.

The [live log snapshot](streamdeck-audio-mixer/master-live.log) records this startup
and Google Chrome playback appearing/disappearing while MASTER stayed at the
rightmost position. No physical master rotation/click was captured in that
snapshot; the hands-on confirmation request remains pending. The mixer continues
running for Manuel to test it. The compiled CLI's mock mixer also exits normally.

The original six-app mixer proof remains in
[streamdeck-audio-mixer.md](streamdeck-audio-mixer.md). The current layout reserves
one of those six positions for the master.
