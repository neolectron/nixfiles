# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Manuel, an experienced developer, programming his Stream Deck under NixOS/niri.

## Product Purpose

Define device management once, then quickly script buttons, dials and touch
behaviors. A local web editor configures actions and previews the running deck.

## Operating Context

The tested + XL has 36 keys, six dials and a 1200×100 touch strip. The existing
Effect mixer controls real playback applications and keeps Master pinned.
The engine operates independently of an open browser.

## Capabilities and Constraints

Effect 4 owns USB, commands, state and resource scopes. Node 24 executes native
`.ts`, imports use `.ts`, typecheck is `noEmit`, no barrel or build script.
React/Takumi renders physical LCD images. The browser interface uses React.
First editor actions: launch an installed application, run a script/CLI, and
a visual counter for testing. Saving a binding never executes it.
App/master mute remains on the existing dials. No implicit microphone or
recording activation. Configuration stays in the isolated clone by default.
Named folders can contain any shortcut and nested folders. Disjoint key zones
navigate independently; pagination actions target a zone or the LCD audio mixer.
Fixed shortcuts remain available through navigation, and folders always provide
a Return key. Existing profiles migrate with a backup and preserve assignments.

## Brand Commitments

The LCD keeps the user's Elgato-inspired arc cards. For the web editor the user
wants useful ideas from Elgato and OpenDeck, with an Effect/TypeScript engine.

## Product Principles

- One owner of the USB device and one implementation of each action.
- Explicit configuration separated from execution.
- Preview actual outgoing images, with unknown/unmanaged images identified.
- Scripts remain a first-class escape hatch beyond the configurable actions.

## Open Decisions

Additional profiles, imported third-party plugins and JSX tooling are future
work. The current increment retains `.ts` execution and React `createElement`.
