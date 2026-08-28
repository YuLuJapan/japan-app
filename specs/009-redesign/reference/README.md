# Redesign reference screens

Rendered from `Onward Redesign Options.dc.html` (exploration round 1) — the design file
that PR #93 implemented and PR #94 reverted. These images exist so the Monday items can
show the screens without anyone opening the design file.

Tracked in Monday on the "Onward — Next Four" board:

- Trip and city screens — **009 · Redesign**, `US1 · Open my trip and see where I am in it at a glance`
- Map directions — **004 · Map**, `◆ FEATURE — Map`

## Trip and city

| File | Option | Status |
| --- | --- | --- |
| `trip-1e-collapsed.png` | 1e · countdown collapsed (default) | Chosen |
| `trip-1f-expanded.png` | 1f · countdown expanded, one tap in | Chosen |
| `city-1g.png` | 1g · city screen | Chosen |
| `trip-1a-story-hero.png` | 1a · countdown always expanded | Not taken |
| `sheet-trip-and-city.png` | 1e / 1f / 1g side by side | — |

## Map

No direction is picked yet. The 004 stories specify the behaviour; these are three
arrangements of it.

| File | Option |
| --- | --- |
| `map-2a-full-bleed-explore.png` | 2a · map owns the screen, peeking filter sheet |
| `map-2b-split-map-list.png` | 2b · map on top, synced place list below |
| `map-2c-city-chapters.png` | 2c · whole-trip clusters by city, tap to zoom in |
| `sheet-map-directions.png` | 2a / 2b / 2c side by side |

PR #93 built 2c — and only the arrangement, with no tile layer underneath.

## How these were rendered

Headless Chromium at 300 px device width and 2× scale (so each PNG is 600 px wide),
with the design file's own webfonts (Bricolage Grotesque, Plus Jakarta Sans). Each phone
frame was expanded to its full scroll height first, so nothing below the fold is cut off.

Hero photos render as grey placeholders: the design file references `assets/temple-tokyo.webp`,
which is not part of what was shared. Options 1b, 1c, 1d and 2d are empty in the source file.
