# Volume boost and feedback — 13 October 2026

Following the app/master commits `0022925d` and `c86c9cd5`, Manuel requested
amplification above 100% and then chose a final ceiling of **200%**. Both app
and default-output MASTER controls now use the same 0–200% policy. Rotation
continues to preserve channel balance and mute; the mock service follows the
same limit. Each emitted raw channel value remains within the protocol bounds.

Percentage feedback is white up to 100%, then smoothly interpolates from yellow
just above 100% through orange at 150% to red at 200%. It remains red for external
values above 200%. The gauge is full at 100%; text still shows the actual amplified
percentage. Muted/offline feedback keeps its existing appearance. No audio value
is changed automatically during startup, polling or rendering.

Protocol bounds were verified against the installed PulseAudio 17 `volume.h`
and upstream sources: nominal volume is `0x10000`, maximum valid raw volume is
`UINT32_MAX / 2`. These are distinct from the selected **200% mixer ceiling**.
The decoder still accepts valid external values beyond the mixer ceiling and
rejects invalid raw volumes. Sources:
[PulseAudio 17 volume.h](https://github.com/pulseaudio/pulseaudio/blob/v17.0/src/pulse/volume.h),
[PipeWire 1.6.9 Pulse conversion](https://github.com/PipeWire/pipewire/blob/1.6.9/src/modules/module-protocol-pulse/message.c).

Three additional tests cover real-service app/master amplification and 200%
clamping with channel balance, equivalent mock behavior, and the actual rendered
percentage pixels for white/yellow/orange/red. The old 100% ceiling regression
now verifies >100% behavior instead. No package installation, dependency or Nix
configuration change, microphone/capture change or keep-awake edit.

The previous master report records its original 100% limit as historical proof;
this report and the package README describe the new policy.

Final checks with the selected 200% ceiling: **42 Stream Deck tests pass**,
typecheck and build pass, and `git diff --check` is clean. The previous live
mixer was stopped with SIGINT, and this version restarted in the dedicated
Ghostty terminal. The [live startup snapshot](streamdeck-audio-mixer/boost-live.log)
records a successful + XL connection and completed feedback: Discord 64%, Spotify
20%, MASTER 100%, all unmuted. No automatic amplification was performed to test
the change; >100% commands and colored percentage pixels were tested with inert
fixtures. The mixer remains available for physical use.
