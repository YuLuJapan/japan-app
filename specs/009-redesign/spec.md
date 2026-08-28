# 009 · Redesign the trip and city screens

Rebuilds the app's two busiest screens from `Onward Redesign Options.dc.html`
(exploration round 1). **The living spec is on the Monday board "Onward — Next
Four", group 009 · Redesign** — this file records the scope and the decisions so
the code has something local to point at, rather than restating the brief.

- ◆ FEATURE — Redesign the trip and city screens — the full brief
- FOUNDATIONAL · The tokens every screen reads
- US1 · See where I am in the trip the moment I open it
- US2 · Open a city and see its whole world in one screen
- US3 · Read the day as a timeline, and see what each thing is

Rendered screens are in `reference/`, and `reference/README.md` says which
option each one is.

## Options picked

| Screen | Built                                       | Rejected                                                                                 |
| ------ | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Trip   | **1e** collapsed countdown, **1f** expanded | 1a — countdown always expanded, which pushes the journey and the day rail below the fold |
| City   | **1g**                                      | —                                                                                        |

The same design file explores three **map** arrangements (2a / 2b / 2c). None is
built here — the map is [004 · Map](https://lkirsmans-team-company.monday.com/boards/5103092435/pulses/3191900327),
it has its own foundational blocker (no place has coordinates yet), and its
direction is still an open pick.

## Scope

**In:** the trip screen, the city screen, the day plan timeline, and the tokens
all three read.

**Out:** the map; anything needing a new column or a migration. Nothing is
removed — this is a rebuild of surfaces that already existed, so the test that
matters is that everything the old screens could do, the new ones still can.

## What must keep working

Export (both buttons, the `export-trip` flag, the field-policy tables), roles
and the four content flags, reminders and push, install/PWA, analytics and
feature flags, the terms gate, and the destination-gated Essentials. None of it
is visible in the mockups and all of it survives the rebuild untouched.

## Decisions worth not re-litigating

- **The hero takes the short label** (`name || country`), not `display_title`.
  40px extrabold over a photo cannot hold "Yuval and Luciana in Japan".
  `HeroTitle` still renders the composed, accented title behind the
  `journey-sushi-hero` flag, and the trips list and the export still use it.
- **The countdown opens collapsed.** The old two-pane carousel hid the return
  flight behind a gesture nobody found; the two directions are now stacked one
  tap in.
- **`place_category` and `place_files` are view fields, never columns.** The
  export's field policy is keyed on `keyof ItineraryItem`, so a stored column
  could not have been added without someone classifying whether a category tag
  belongs in a shared PDF. As a view field the question never arises, and the
  two tags follow the visibility rules that already exist: the category goes
  wherever `place_id` was already nulled, and the file names go whenever
  documents are withheld.

## History

PR #93 built this and was reverted in PR #94 fourteen minutes later, with no
reason recorded. This lands it again on the same base, minus the map.
