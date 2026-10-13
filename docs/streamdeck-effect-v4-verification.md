# Effect v4 rewrite — verification, 13 October 2026

Work completed in the isolated clone
`/home/neolectron/Documents/Codex/2026-10-13/task-11/nixfiles-streamdeck`, branch
`feat/streamdeck-usb-hello`, starting from the verified PoC commit `6e71743`.
The original PoC commits and physical input/display proofs remain in history.

## Implementation delivered

- Effect 4.0.4 and matching Node platform package pinned in Stream Deck only.
- Public `StreamDeck` and `Driver` services, scoped live/mock layers, typed errors,
  normalized event streams, validated display operations and exact USB identity.
- Serialized in-flight writes and scoped cleanup on success/failure/interruption.
- Sequential bindings, touch zones and explicit pages preserving press ownership.
- Effect-native `Command`/`Flag`/`Schema` CLI, generated help and `NodeServices`.
  No `parseArgs`, direct `process.argv`, manual timers/signal handlers, handwritten
  promise queues or runtime execution inside library modules.
- Editable Effect scripts: hello, playground and pages. The original command
  names remain; their implementation is replaced, not retained as a legacy runtime.
- Public package exports and compiled JavaScript/declarations.

## Automated checks

- Final Stream Deck suite: **22 tests, all passing**. Includes resource release,
  broadcast delivery, early errors, overflow, invalid displays/regions, models
  without LCDs, native call serialization, interrupted writes, pixel snapshots,
  sticky failures, all gesture routing, touch zones, pages, disconnect during a
  suspended handler, hello state, retained handles, mock CLI and Effect CLI help/
  validation. CLI tests clear `LD_LIBRARY_PATH` to prove mock operation stays
  independent of native HID.
- The full monorepo suite passed during the rewrite: the then-current 19 Stream
  Deck tests plus **22 keep-awake tests**. Three additional Stream Deck tests were
  added for the final CLI/handler changes and interruption/error race, then the
  full Stream Deck suite rerun. **44 tests validated in total**; keep-awake
  sources remained unchanged.
- Root `pnpm typecheck` and `pnpm build` passed. Final Stream Deck typecheck/build
  were rerun after the CLI change and final interruption/error regression.
- Compiled `dist/cli.js`: hello mock + LCD finite demo, playground mock with
  duration, and pages mock with duration all succeed. The finite hello result
  remains seven inputs, five key frames, five LCD frames and simulated level 51.
- `nix flake check --no-write-lock-file`: exit 0, existing nonstandard-output
  warnings, zero build checks executed. The keep-awake derivation still evaluates
  to the same store derivation as before the rewrite.
- `git diff --check` clean; no Nix lockfile changes.

## Real USB smoke checks

Before opening, `udevadm` reconfirmed `Stream Deck + XL`, `0fd9:00c6`, and
`getfacl` reconfirmed Manuel's existing `user:neolectron:rw-` ACL on `/dev/hidraw8`.
No permissions were changed by this rewrite.

1. [30-second smoke](streamdeck-effect-v4/usb-smoke.log): rewritten Effect service
   opens the hardware, writes the first key and LCD strip, reaches the listening
   state, times out normally and closes without errors; exit 0.
2. [Final Effect CLI smoke](streamdeck-effect-v4/effect-cli-usb-smoke.log): the
   `Command`/`Flag` CLI parses `hello --lcd --path /dev/hidraw8 --duration 5` and
   runs the same physical write/close path; exit 0.

The listening message occurs only after the initial render has completed, so it
attests that both native write calls completed. No physical input was recorded
in these two new smoke windows, and no new visual confirmation was requested.
The [earlier hands-on proof](streamdeck-hardware-2026-10-13.md) validates the same
driver/model's button edges, signed rotations, dial clicks, visible HELLO/OK,
strip feedback and short taps/swipes. Hold gestures are covered by the new mock
router test, but still not confirmed by a physical hold event.

## Preserved scope and remaining limits

The main checkout and preparation worktree were not edited. No push, merge,
global configuration, Home Manager activation, NixOS rebuild, USB rule activation,
microphone, OBS recording, Discord action, audio change or Formula operation.
No desktop-project attachment is claimed. Parent owns the Notion update/merge.

No keep-awake package, npm lockfile, installed binary/configuration or GC root
was changed. The shared pnpm lockfile gains only Stream Deck dependencies and
their resolution records. pnpm added exact release-age exceptions for the three
matching Effect 4.0.4 packages; the existing zod exception and native-build
allowlist are preserved.

The USB ACL remains temporary. Automatic reconnect, image-file decoding/richer
font rendering and application integrations are not implemented. Hardware API,
scripts, boundaries and tradeoffs are documented in the [package README](../packages/streamdeck/README.md)
and [research report](streamdeck-effect-v4-research.md).
