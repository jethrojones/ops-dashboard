---
version: alpha
name: Glassline
description: Fog-grey neutrals with a cobalt pinprick.
colors:
  primary: "#0F1419"
  secondary: "#4A5568"
  tertiary: "#2C5EF5"
  neutral: "#F1F3F5"
  surface: "#FFFFFF"
  on-primary: "#FFFFFF"
typography:
  display:
    fontFamily: Geist
    fontSize: 3.75rem
    fontWeight: 600
    letterSpacing: "-0.03em"
  h1:
    fontFamily: Geist
    fontSize: 2.25rem
    fontWeight: 600
    letterSpacing: "-0.02em"
  body:
    fontFamily: Geist
    fontSize: 0.95rem
    lineHeight: 1.55
  label:
    fontFamily: Geist Mono
    fontSize: 0.75rem
    letterSpacing: "0"
rounded:
  sm: 6px
  md: 10px
  lg: 16px
spacing:
  sm: 8px
  md: 16px
  lg: 32px
components:
  button-primary:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
    padding: 12px 20px
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.lg}"
    padding: 24px
---

## Overview

A cool, quiet palette built around 8-step neutrals. A single cobalt for
action keeps the interface calm but directable.

## Colors

The palette is built around high-contrast neutrals and a single accent
that drives interaction.

- **Primary (`#0F1419`):** Headlines and core text.
- **Secondary (`#4A5568`):** Borders, captions, and metadata.
- **Tertiary (`#2C5EF5`):** The sole driver for interaction. Reserve it.
- **Neutral (`#F1F3F5`):** The page foundation.

## Typography

- **display:** Geist 3.75rem
- **h1:** Geist 2.25rem
- **body:** Geist 0.95rem
- **label:** Geist Mono 0.75rem

## Do's and Don'ts

- **Do** use Tertiary for exactly one action per screen.
- **Do** let Neutral carry the composition — negative space is a feature.
- **Don't** introduce gradients. This system is flat on purpose.
- **Don't** mix Tertiary with alternate accents; the single-accent rule
  is load-bearing.

## How to swap the design

The tokens above are mirrored in `src/frontend/styles.ts` (the
`:root` block at the top). To re-skin the app:

1. Edit the six color tokens, the font families, the radii, and the
   spacing values at the top of `styles.ts` to match a new palette.
2. The status colors (success / warning / danger) are separately tunable.
   Keep them neutral-leaning so they don't fight the single-accent rule.
3. The compat aliases at the bottom (`--ll-*` namespace) are wired to the
   semantic tokens — they exist so the per-page HTML doesn't need to
   change when you swap palettes. Leave them alone unless you're
   refactoring the HTML to use semantic tokens directly.
4. The failure-email template (`src/lib/resend.ts`) has its own `TOKENS`
   constant — email clients can't read CSS variables, so the values are
   inlined. Update that block to match when you swap the palette.

## Why these specific defaults

This template ships with Glassline as a deliberate choice:

- **One action color.** The Tertiary cobalt makes the "what do I click?"
  question trivial on every page.
- **Neutral chrome.** Navigation, cards, badges, log rows all use
  neutrals so failures (red) and successes (green) read at a glance.
- **Geist over Inter / Montserrat.** Geist has good Mono pairing and
  is hosted on Google Fonts CDN — no font bundling required.
- **Small radii.** 6/10/16px — feels modern without screaming
  "this is a design system" via tech-bubble pill buttons.

If you don't like it, swap it. The point of the platform isn't the
visuals; it's that you own the rendering and can change it in 15
minutes.
