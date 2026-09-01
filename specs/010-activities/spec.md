# 010 — One thing, with an optional date

**Status:** proposed
**Depends on:** 001 (places, itinerary), 003 (export), 004 (map), 006 (chat context)
**Touches production data.** See [`migration.md`](./migration.md) before running anything.

## The problem

The app has two entities for what a traveller thinks of as one thing.

A **place** lives in a city, carries a category, a description, an address, links, a photo,
coordinates, files and tips — and has no date. An **itinerary item** has a date, a time, a
title, a note, its own category, and an optional link to a place — and can carry no file, no
location and no link.

Both have tags. Only one can be scheduled. Only the other can hold a document or a pin. So
"the ramen place we want on Thursday" is either two rows the traveller has to create and keep
in step, or one row missing half of what they wanted.

**The split is not being used as designed.** In the live database
(2026-09-01 20:08 UTC — it is live, so these move):

|                                                    |               |
| -------------------------------------------------- | ------------- |
| plan lines that are free text with no linked place | **179 / 226** |
| places never scheduled onto a day                  | **39 / 56**   |
| rows that actually use the `place_id` link         | **18**        |
| places with more than one entry                    | **3**         |
| places carrying a location                         | **13 / 56**   |

The entity/event split is a defensible model — a thing and a scheduled occurrence of it are
genuinely different — but it costs two forms, two lists, two field sets and two mental models,
and it buys the link on 18 rows out of 282 — and until 2026-09-01 six more pointed at the wrong
place, unnoticed for a month, because a link surfaces only as a category pill and a file list
(`migration.md` §3a). They came from one bulk import rather than from the app, so it was never
a running defect; it is a feature dim enough that a third of one import's guesses could be
wrong without anyone seeing. The common case, by a factor of seven, is a
traveller typing a line onto a day and never saving a place at all. That line can then never
hold the ticket PDF or show up on the map.

## What this builds

One entity: an **activity**.

```
activity
  name, name_ja, description        what it is
  category                          the tag: stay / thing to do / food / shopping / more
  zone_id                           the city it is in
  day, start_time, position         WHEN — all optional
  address, lat, lng                 WHERE — optional
  links, image_url                  optional
  highlight, icon                   a day banner, when it is one
  → files, → tips                   attached to the activity itself
```

**The date is the only thing that decides where it shows.**

|                 |                                                                                |
| --------------- | ------------------------------------------------------------------------------ |
| `day` set       | the day plan — the trip screen's timeline, and its city's Schedule             |
| `day` null      | **Explore** on the city page, grouped by category, exactly as places are today |
| `lat`/`lng` set | a pin on the map — **whether or not it has a date**                            |

Scheduling something saved is setting its date, and it moves from Explore to the plan.
Un-scheduling it is clearing the date, and it moves back. There is one form, one list
endpoint, one detail screen, one field set.

## Requirements

### The model

- **FR-001** An activity has an optional `day`. An activity with a day is _scheduled_; one
  without is _saved_. No other field distinguishes the two.
- **FR-002** Every activity may carry a location (`lat`/`lng`), files and tips, whether or not
  it is scheduled.
- **FR-003** An activity's `category` is optional. Null means untagged: no pill on the day
  plan, and in Explore it groups under **More** without `other` being written to the row.
- **FR-004** A **saved** activity must belong to a city (`zone_id`), or Explore has nowhere to
  put it. A **scheduled** activity may have none, which is the state four rows are in today;
  they keep today's behaviour (shown on any city page the day touches, and leading the trip
  screen's day in an unnamed band — `daySections` is unchanged). Enforced by the service, not
  by a check constraint — see `migration.md` §2 for why the obvious constraint breaks trip
  deletion.
- **FR-005** `highlight` requires a day. A featured note banners a day; there is no day to
  banner without one.
- **FR-006** One activity has **one** date. Something visited on two days is two activities.
  See _What this gives up_.

### Where things show

- **FR-010** The city page's **Schedule** shows that city's scheduled activities for each day
  it touches. Unchanged from today apart from its source.
- **FR-011** The city page's **Explore** shows that city's _saved_ (undated) activities,
  grouped by category, with a count per category. A category with none is hidden, as today.
- **FR-012** The trip screen's day plan shows scheduled activities banded by city on a moving
  day, unchanged (`daySections`, `primaryStep`, `zoneChoices` all keep working on the merged
  row).
- **FR-013** The map's city scale pins **every** located activity in the city, scheduled and
  saved alike, filtered by the category chips. The trip scale is unchanged: one pin per city.
- **FR-014** The "could not be pinned" count and list (FR-019 of spec 004) counts every
  activity in view without coordinates, scheduled ones included.
- **FR-015** Search covers every activity, scheduled and saved.

### Visibility

The four `can_see_*` flags and the writer-always-sees-everything rule are unchanged. What
changes is what "a stay" means now that a stay is an activity.

- **FR-020** A **saved** activity tagged `hotel` is withheld wholesale from a member whose
  view hides stays — from Explore, the map, search, the detail screen and the export. This is
  exactly today's rule for a `hotel` place.
- **FR-021** A **scheduled** activity tagged `hotel` keeps its row on the day plan and loses
  its content: `description`, `address`, `links`, `image_url`, `lat`, `lng`, its files, its
  tips and **its category** are all dropped. `name`, `day`, `start_time`, `position`,
  `highlight` and `icon` survive.
  - Dropping the category is what stops the row announcing itself as a stay through its
    coloured pill — the same job `place_category` nulling does today.
  - This is a **behaviour change worth stating**: 43 plan lines are tagged `hotel` today and
    are fully visible to every member, pill included. After this, a member whose view hides
    stays sees them stripped. No member currently has stays hidden, so nothing on screen
    changes on the day this ships.
  - The residual risk is stated rather than solved: the name is typed by the traveller, so
    "Hakone Yutowa 15:00" still names the hotel. A rule cannot tell a safe title from a
    revealing one, and dropping the row would leave a hole in the day that says something was
    there.
- **FR-022** A withheld stay is not pinned, not counted as a pinnable-but-unlocated activity,
  and not searchable — its coordinates were dropped before any of those ran.
- **FR-023** The order of the two filters is unchanged and is still the requirement: the
  caller's `TripView` is applied **first**, the field policy second (spec 003).

### Data

- **FR-030** No information is lost. Every pre-migration row survives verbatim, either as an
  activity or in the source tables, which are not dropped in the same release.
- **FR-031** Ids are preserved. An activity created from a place keeps the place's id, so
  `files`, `tips`, saved links, reminder URLs and open bookmarks all keep resolving.
- **FR-032** `/trips/:tripId/places/:id` redirects to `/trips/:tripId/activities/:id`.
- **FR-033** Every folding decision is journalled with both source rows verbatim, and is
  reversible by script.

## What this gives up

**One saved thing can no longer be scheduled on several days.** Today a place can back three
plan entries; after this, three days means three activities, and the location, address, photo
and description are copied onto each. Editing one does not update the others.

This is the cost of the single mental model, and on today's data it is paid in nothing at all.
Three places carry more than one entry, and **none of them is a repeat visit**
(`migration.md` §3a):

- Nishiki Market and Omicho Market each have two entries on the **same day** — a lunch and a
  snack, which the merged model expresses as two activities anyway;
- the only place spanning two days is called "Check", and is test data;
- Higashi Chaya District and Lake Kawaguchi looked multi-day until 2026-09-01, when the stale
  links that made them look that way were removed. Each has one real entry.

So the trade is being made with the evidence in hand rather than in the abstract:

- the alternative — one `activities` table plus a small `occurrences` child holding
  `(day, time, position)` — keeps the ability but is the two-concept model again, and would
  make every free-text plan line (179 of the 226) write two rows instead of one;
- and the thing being given up has never once been used as intended.

What softens it is a **Copy to another day** action on a scheduled activity: one tap, and the
copy carries the location, address, photo, category and description. That is also exactly the
rule the migration uses for a place scheduled more than once, so the product and the migration
agree by construction.

## What is deliberately _not_ changing

- `journey_steps` still model the stay range per city. A hotel is still a saved activity, and
  the migration never gives one a date (`migration.md` §3) — the reservation stays in Explore
  under **Stays** where it can be looked up on any night of the stay, rather than becoming an
  event on the check-in day.
- `daySections`, `primaryStep`, `zoneDays` and the moving-day rules are untouched. They read
  `zone_id` and `day`, which the merged row still has.
- `zones`, `journey_steps`, `shopping_items`, `reminders`, the flight, chat and the export's
  two detail levels all keep their current shapes.
- The shopping list is **not** merged in. An item on it is a present; it is withheld
  wholesale, is trip-level rather than city-level, and has a price and a bought flag. It is a
  different thing that happens to have a category.

## Success

- **SC-001** A traveller adds one thing, gives it a tag, optionally a date, optionally a
  location and optionally a file, from one form.
- **SC-002** Everything visible in the app before the migration is visible after it, in the
  same place, except where FR-021 deliberately narrows a restricted view.
- **SC-003** The map shows located activities that have a date. Today it cannot.
- **SC-004** `npm test`, `npm run typecheck` and `npm run lint` pass. The typecheck matters
  more than usual here: the export's field policy and the map's list policy are both
  `Record<keyof Entity, …>`, so merging two entities into one is a compile error until every
  field has been classified once.
