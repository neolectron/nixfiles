# Elgato plugin compatibility research

Checked 2026-10-13. Scope: popular original Elgato/Marketplace packages on Linux,
with our Effect 4 HID owner and React/Takumi mixer. This is feasibility research;
no third-party plugin or OpenDeck was installed or executed against the device.

## Current mixer

Manuel confirmed the physical React/Takumi demo works. The demo owner was
interrupted and its terminal closed before starting the real mixer:

```sh
pnpm dev --renderer react --path /dev/hidraw8
```

The connected device is still the Stream Deck + XL, 36 keys and six dials.
The live snapshot has Plants vs. Zombies at 100% and the default output at 100%.
Real PipeWire-Pulse discovery, volume and mute are restored. React presentation,
swipe pagination, pinned Master and watch mode are retained. No audio value was
changed by the restoration. Original checkout, USB permissions, Nix activation,
installed keep-awake integration and Formula production are untouched.

## Popularity evidence

The [Marketplace plugins page sorted by Popular](https://marketplace.elgato.com/stream-deck/plugins?sort=-download_count)
was inspected in the live browser. The selected control explicitly says
**Popular**; initial product order is listed below. There are no public download
totals in this view. This is its displayed order at retrieval, not an independent
measurement of active users. Search indexing and server-side page extraction
sometimes omit the loaded products; live DOM inspection confirmed the order.

| Position | Plugin / publisher | Linux feasibility for the original package |
| --- | --- | --- |
| 1 | Volume Controller / Elgato | Official per-app action is Windows-only. Our PipeWire service already supplies the needed app/output behavior. Running a Windows audio API would not control native Linux streams. |
| 2 | OBS Studio / Elgato | Not a good first unchanged-package candidate: OpenDeck's maintainer reports dependencies on Stream Deck internals. Use OBS WebSocket directly or investigate the portable Multi OBS Controller alternative. |
| 3 | Discord / Elgato | Historical original package runs under Wine after a process-name/manifest adjustment, according to OpenDeck. Latest Marketplace package is not verified. Prefer the current native OpenAction Discord alternative. |
| 4 | Voicemod / Voicemod | Plugin is only a controller for the companion voice app. Voicemod desktop Linux support is still on its roadmap. A compatible host alone cannot provide the voice engine. |
| 5 | Spotify Integration / BarRaider | Windows-only, requires Premium. Current package untested; related BarRaider host validation makes it a poor first target. Linux media control is available through MPRIS; playlist/cloud behavior is separate. |
| 6 | Control Center / Elgato | Listed Mac/Windows. Need to inspect the actual package and companion dependencies; network light control is a separate possible integration, not confirmed package compatibility. |
| 7 | Twitch / Elgato | Potential candidate if its package is portable and available unprotected. OAuth/deep-link/account integration and native helpers must be checked; not validated. |
| 8 | YouTube / Elgato | Same conditional feasibility as Twitch. The current package must be inspected before claiming unchanged execution. |
| 9 | Spotify / Elgato | Distinct from BarRaider's plugin. Desktop integration explicitly requires Mac/Windows; cloud actions additionally require login. Need a Linux backend or adaptation, not just HID support. |
| 10 | Audio Switcher / Fred Emmott | System audio switching needs an OS backend. PipeWire is the practical native implementation; package itself untested. |
| 11 | Win Tools / BarRaider | Windows system operations have no equivalent execution context on niri. Recreate selected behaviors through Linux/Wayland services rather than importing Windows actions. |
| 12 | OBS Tools / BarRaider | OpenDeck documents v3.2 and earlier working under Wine, v3.3+ incompatible. Current Marketplace v3.6 is outside that reported working range. |
| 13 | Clocks / Elgato | Simple UI/time behavior makes it an attractive candidate, but this current package has not been inspected. The older open Analog Clock sample is a known portable browser-based reference; it is a different plugin. |
| 14 | SuperMacro / BarRaider | Windows-only keyboard/mouse simulation. Wine input cannot be assumed to target native Wayland apps. Implement desired macros through compositor/portal-aware Linux services. |

Product/dependency evidence: [Volume Controller](https://marketplace.elgato.com/product/volume-controller-34d9aa59-a41a-4a4c-a853-202ca91409e1),
[OBS Studio](https://marketplace.elgato.com/product/obs-studio-35615969-830f-45c9-ba0a-1a295bba7fec),
[Discord](https://marketplace.elgato.com/product/discord-e3559f36-d31d-4529-ab1f-739955e2ac7a),
[Voicemod platform support](https://support.voicemod.net/hc/en-us/articles/360013372900-Where-can-I-use-Voicemod),
[Spotify Integration](https://marketplace.elgato.com/product/spotify-integration-5e3a6d60-570a-40f3-b186-dbcd122216a2),
[Control Center](https://marketplace.elgato.com/product/control-center-39a4fa43-1afe-457a-8a19-b5d386e77d53),
[Twitch](https://marketplace.elgato.com/product/twitch-54e38b3b-89ab-4400-b55f-645378785709),
[YouTube](https://marketplace.elgato.com/product/youtube-1aff8623-89a4-456e-88a8-76724ae7cb4b),
[Spotify](https://marketplace.elgato.com/product/spotify-17f49e8b-09a0-4209-95ed-6dee2469f97b),
[OBS Tools](https://marketplace.elgato.com/product/obs-tools-1736515e-1452-41a3-9548-d2b3a689076f),
[Clocks](https://marketplace.elgato.com/product/clocks-a150a62e-0e32-4d9c-9443-60b8b398e83a),
[SuperMacro](https://marketplace.elgato.com/product/supermacro-62195fec-7bcb-403d-b650-c342e9dfec67).
Feasibility judgments are our inferences; compatibility reports are version-bound.

## Why a plugin host is possible

Original plugins generally communicate with the desktop app, not directly with
USB. The documented [plugin WebSocket API](https://docs.elgato.com/streamdeck/sdk/references/websocket/plugin/)
uses registration plus action contexts: `willAppear`, key/dial/touch events,
settings, `setImage`, `setTitle`, `setState`, `setFeedback` and
`setFeedbackLayout`. The [manifest](https://docs.elgato.com/streamdeck/sdk/references/manifest/)
specifies entrypoints and runtime/OS requirements; its official OS vocabulary is
Mac/Windows. Pure JavaScript may nevertheless be portable if its dependencies
and platform branches are compatible. Changing a manifest alone does not port
Windows/macOS APIs or binaries.

Our HID owner could translate inputs to these messages and decode plugin images
back into the existing display API. Encoder feedback is structured layout data,
so supporting knobs also needs Elgato built-in/custom layout rendering, not just
forwarding a PNG. Settings and the HTML property inspector need their own host
integration. This service does not exist in our library yet.

[OpenDeck](https://github.com/nekename/OpenDeck) is evidence that this works in
practice. Its inspected revision is `66db15d9d5d41597772a4f209cd6a93b498fc7df`.
The following implementation files were read without executing the app:

- [Plugin lifecycle](https://github.com/nekename/OpenDeck/blob/66db15d9d5d41597772a4f209cd6a93b498fc7df/src-tauri/src/plugins/mod.rs): Node scripts, hidden webviews for HTML plugins, native binaries or Wine, separate processes and WebSocket registration.
- [Inbound commands](https://github.com/nekename/OpenDeck/blob/66db15d9d5d41597772a4f209cd6a93b498fc7df/src-tauri/src/events/inbound/mod.rs) and [display state](https://github.com/nekename/OpenDeck/blob/66db15d9d5d41597772a4f209cd6a93b498fc7df/src-tauri/src/events/inbound/states.rs): image/title/settings/encoder feedback handling.
- [Device providers](https://github.com/nekename/OpenDeck/blob/66db15d9d5d41597772a4f209cd6a93b498fc7df/src-tauri/src/events/inbound/devices.rs): external `registerDevice`/input events, with image output returned to the provider. An Effect-to-OpenAction adapter is a plausible alternative to implementing the full original host API, but is not tested here.

An external backend must have its own Elgato discovery disabled so it does not
compete with our HID owner. Third-party actions would own explicitly allocated
keys/regions, avoiding writes over the mixer. OpenDeck is GPL-3.0-or-later;
consult its licensing before copying implementation code. A protocol adapter
can use the public documentation instead. No source was copied into our library.

## Current blockers

**DRM matters even for otherwise portable plugins.** Elgato's
[distribution documentation](https://docs.elgato.com/streamdeck/sdk/introduction/distribution/)
describes file encryption and integrity protection, enabled by default when
packaging with CLI 1.6+. Protection is applied when a package is processed in
Maker Console; not every SDK v3 package is encrypted. The
[OpenDeck Marketplace guide](https://github.com/nekename/OpenDeck/wiki/0.-Elgato-Marketplace)
reports protected downloads unreadable in third-party hosts. Select openly
distributed source/packages or author-authorized builds for testing; a generic
WebSocket bridge does not make protected Marketplace archives runnable.

**Wine is conditional.** It can launch some Windows plugin binaries, but does
not supply a native Linux audio/window API or the companion app they control.
Latest BarRaider plugins also have explicit compatibility problems beyond Wine:
the [OBS Tools compatibility page](https://github.com/nekename/OpenDeck/wiki/OBS-Tools-by-BarRaider)
documents the version boundary. Do not treat all Windows plugins as working.

**Portable HTML still needs JavaScript execution.** Counter, Analog Clock and
Multi OBS Controller use browser technologies. Takumi rasterizes our static
React views; it does not execute their DOM, canvas, timers or WebSocket code.
Hosting those unchanged requires a browser/webview runtime. Native Node plugins
are therefore the simpler class for a minimal Effect process/WebSocket host.

## Recommended next trial

1. Prove the host contract with a small openly distributed plugin: registration,
   one action/context, settings, a key event and the returned image/title, plus
   scoped child/socket shutdown. Use an existing Node SDK sample for the minimal
   no-browser trial; Counter/Analog Clock are additional browser compatibility
   references, not claims that the modern Clocks package works.
2. For useful functionality, investigate
   [native OpenAction Discord](https://github.com/OpenActionPlugins/discord)
   rather than pinning an old Wine workaround. OpenDeck's
   [historical Discord note](https://github.com/nekename/OpenDeck/wiki/Discord-by-Elgato)
   describes the old process-name issue; its current
   [troubleshooting guide](https://github.com/nekename/OpenDeck/wiki/0.-Discord-plugin-troubleshooting)
   describes native Discord IPC access. Authentication, supported RPC operations
   and compatibility with the installed client still need validation.
3. For OBS, either run the open
   [Multi OBS Controller](https://github.com/theca11/multi-obs-controller)
   through a browser-capable host, or write a small Effect service for
   [OBS WebSocket](https://github.com/obsproject/obs-websocket).
   OpenDeck [reports Multi OBS Controller 0.8.0 working](https://github.com/nekename/OpenDeck/wiki/Multi-OBS-Controller-by-the_ca11)
   as of 2025-04-30; newer versions are not verified here. OBS itself supports
   Linux, so neither approach needs the official desktop app's private integration.

The practical target is **selected compatible plugins alongside our scripts**,
not unrestricted Marketplace compatibility. Keep the existing audio mixer in
Effect; choose specific unprotected packages and prove each version separately.
