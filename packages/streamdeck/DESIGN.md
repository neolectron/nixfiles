---
name: Stream Deck audio mixer
description: Elgato-inspired LCD cards for physical rotary audio control.
colors:
  bezel: "#0D0D10"
  surface-top: "#41414D"
  surface-bottom: "#35353F"
  title: "#F4F4F7"
  secondary: "#C5C6CF"
  inactive: "#B8BAC5"
  track: "#24252B"
  nominal: "#38E51E"
  boost-yellow: "rgb(255,220,40)"
  boost-orange: "rgb(255,145,30)"
  boost-red: "rgb(255,55,55)"
typography:
  title:
    fontFamily: "Liberation Sans"
    fontSize: "15px"
    fontWeight: 700
  value:
    fontFamily: "Liberation Sans"
    fontSize: "30px"
    fontWeight: 700
  unit:
    fontFamily: "Liberation Sans"
    fontSize: "13px"
    fontWeight: 700
  state:
    fontFamily: "Liberation Sans"
    fontSize: "11px"
    fontWeight: 700
rounded:
  card: "7px"
spacing:
  edge: "4px"
  gutter: "8px"
components:
  mixer-card:
    backgroundColor: "{colors.surface-bottom}"
    textColor: "{colors.title}"
    rounded: "{rounded.card}"
    height: "92px"
---

# Design System: Stream Deck audio mixer

## Overview

**Creative North Star: "Elgato touch-strip mixer"**

Operate mode on a physical LCD. The user supplied Elgato photos and explicitly
chose their semicircular gauges. Rounded charcoal cards, compact mixed-case
names, recognizable source icons and bold right-aligned values carry that style.
This guidance applies to the mixer strip, not the bitmap-key demos or a web app.

## Colors

The bezel separates cards. A restrained vertical surface ramp gives the reference's
tonal depth. Titles and values have high contrast; state labels are secondary.
Green marks nominal gain, while amplification transitions smoothly through the
boost colors. The volume policy is 0–200% for app and master controls.

## Typography

Use the bundled Liberation Sans assets, with measured ellipsis for names. This is
an Arial-compatible approximation of the reference, not Elgato's claimed font.
Keep names mixed case. The numeric value is the strongest role; its unit or state
is smaller and right aligned. Do not reinstate the uppercase 3×5 bitmap font here.

## Layout

The tested strip is 1200×100. Regions derive from hardware dial positions:
168, 216, 216, 216, 216, 168 pixels. Each region has its own inset card. The name
row begins after the icon; the semicircle occupies the lower left and the value
occupies the right. The rightmost region remains Master on all app pages.

## Elevation & Depth

Tonal surface variation provides depth. No drop shadows or glow. Black gutters
and the hardware bezel are sufficient separation at this resolution.

## Shapes

Cards are rounded rectangles. Gauges are upper semicircles with a 34px radius,
small ticks and a pale pointer. Their full sweep covers 0–200%; nominal 100% has
a prominent center tick. Above nominal, the extra arc uses the boost palette.

## Components

The card's name/icon, gauge and value retain their positions across states.
Muted cards keep the stored value, grey the gauge, cross the speaker and say
Muted. Mixed groups say Mixed. Offline feedback uses an amber icon and Offline.
Unassigned app regions say No app; an absent default output says No output.
The arcs display configured gain, not live signal levels in dBFS.

## Do's and Don'ts

- Do render the same SVG cards in previews and on hardware.
- Do preserve name casing, font measurement and the independent unit/state role.
- Do keep app routing and audio ownership outside the display renderer.
- Don't add microphone or recording controls from the reference photos implicitly.
- Don't describe the configured-volume arc as a live audio meter.
