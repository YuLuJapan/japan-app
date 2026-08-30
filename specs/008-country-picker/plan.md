# Implementation Plan: Country picker

**Branch**: `claude/country-picker-feature-y85xb7` | **Date**: 2026-08-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-country-picker/spec.md`

## Summary

The trip sheet's `Country` text input becomes a filter-as-you-type combobox over one
server-served list of 243 countries, and the trip gains a `country_code` column beside the
free text it already has. Typing filters; only a list entry saves; the server derives the
stored name from the code so the pair can never disagree. Everything that reads the country
— the currency guess, the Essentials gating, the analytics grouping — prefers the code where
one exists and keeps its string path for the trips that predate it. Nothing is backfilled.

Three properties carry the design:

1. **One list, server-side.** `server/src/lib/countries.ts` is both what fills the picker
   (via `GET /api/countries`) and what validates the write, exactly as
   `server/src/lib/currencies.ts` already is for currency codes. A second copy in the client
   is the thing that drifts.
2. **The code is the value; the name is a rendering of it.** A write carries `country_code`.
   The server writes `country` from its own list entry. A client cannot store a name the list
   does not have, because it never gets to choose the name.
3. **Additive, in both columns and code paths.** `trips.country` keeps its meaning, its
   80-character cap and every existing value. `isJapanTrip` gains a code path and keeps its
   whole-word string matching. A trip with text and no code is not a broken row; it is the
   ordinary state of every trip that exists today.

## Technical Context

**Language/Version**: TypeScript 5, Node 20 (server), React 18 + Vite (web)

**Primary Dependencies**: Express, TanStack Query, Tailwind. **No new runtime dependency** —
the country list is a hand-held table in the repo, not a package, and the flag is two code
points computed from the alpha-2 code.

**Storage**: Supabase Postgres in production, the in-memory store in dev and tests. One new
nullable column, `trips.country_code`.

**Testing**: Vitest, two projects — `server/tests/*.test.ts` (supertest against `createApp()`
with the fixture store) and `src/tests/*.test.tsx` (React Testing Library). Plus
`npm run typecheck`, which the export's field policy makes non-optional.

**Target Platform**: Mobile-first PWA; iOS Safari and Android Chrome are the phones that matter.

**Project Type**: Web application — one Express app with two entry points, one React client.

**Performance Goals**: The country list is one ~6 KB response cached for the session
(`staleTime: Infinity`, the `useCurrencies` pattern). Filtering 243 rows is a substring scan
per keystroke; no debounce, no virtual list, no index.

**Constraints**: Free tiers only — static data, no geocoding, no API key. Offline-tolerant: the
field shows the trip's own country without the list, and the service worker's `NetworkFirst`
rule already covers `/api`. Nothing new goes to analytics.

**Scale/Scope**: 243 countries, one form field, one endpoint, one column, one migration.

## Constitution Check

`.specify/memory/constitution.md` is the unfilled Spec Kit template — there are no ratified
principles to gate against. The standing rules this plan is checked against are `CLAUDE.md`'s:

| Rule                                                     | How this plan satisfies it                                                                                                                                                                |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Services take the store; never import a concrete backend | Country validation lives in `services/trips.ts` against a pure list module; no store import changes.                                                                                      |
| Reference data is served, not duplicated                 | `GET /api/countries` serves the same module that validates the write.                                                                                                                     |
| A route is access-checked by construction                | The endpoint mounts beside `ratesRouter` — under `authMiddleware`, outside `tripScopedRouter()`. It is not trip content and must not imply it is.                                         |
| Committing a migration is not deploying it               | `0023_trip_country_code.sql` has to be run against the live project; the plan carries that as its own task and the store tolerates the column's absence in neither direction — see Risks. |
| Validation collects all errors                           | The new checks join `collectTripErrors`'s array rather than throwing on the first.                                                                                                        |
| A write answers with the row its list renders            | `country_code` joins the trip payload every `GET` already returns; no new shape.                                                                                                          |
| Analytics carries shapes, never content                  | No new property. `trip_country` and `trip_destination` keep their meaning; the second is computed from the code where there is one.                                                       |
| Budget                                                   | Static table. No service, no key, no cost.                                                                                                                                                |

## What this touches, and what it deliberately does not

**Touched**: the trip form's country field, trip validation and creation/patch, the trip row,
the currency guess, `isJapanTrip`, the analytics `trip_destination` super property, the API
contract document.

**Not touched, on purpose**:

- **`src/pages/Journey.tsx:23`'s private `/\bjapan\b/i`**, which also falls back to `trip.name`
  and so gives a Portugal trip called "Japan reunion" the sushi hero. It is wrong today and
  stays wrong here: collapsing the two definitions of Japan into one is spec 010's foundational
  work, and doing it in passing would put a second Essentials-shaped decision inside a spec
  about a form field. Recorded here so it is not mistaken for an oversight.
- **`CURRENCY_BY_COUNTRY`'s by-name keys.** A `by_code` map is added beside them; re-keying the
  whole thing on ISO codes and dropping the alias rows is its own task (T014), sequenced after
  the picker works, so a currency regression cannot hide inside the feature that caused it.
- **Zones, cities, the journey.** Nothing here creates or edits a zone.
- **Backfilling old trips.** Stated as a requirement, not an omission.

## Delivery slices

Each slice is releasable on its own and leaves the app working.

### Slice A — Foundational: one list, one column

`server/src/lib/countries.ts` (243 entries: alpha-2 code + English name, plus `findCountry`
and `COUNTRY_BY_CODE`), `GET /api/countries` on a new `countriesRouter` mounted beside
`ratesRouter`, migration `0023_trip_country_code.sql`, `country_code` through
`DataStore`/`Trip`/both backends, and `collectTripErrors` learning the code. A guard test
asserts every key in `CURRENCY_BY_COUNTRY` resolves to a country on the list, so the two
cannot drift and no country loses its currency guess (FR-004, SC-004).

Nothing visible ships in this slice. The migration must reach the live project before Slice B
does — see Risks.

### Slice B — US1: the picker

`src/lib/country-flag.ts` (code → regional-indicator pair), `useCountries()` in
`src/api/hooks.ts` (`staleTime: Infinity`, mirroring `useCurrencies`), and
`src/components/CountryPicker.tsx` — an input with `role="combobox"`, a listbox of matches,
arrow-key/Enter/Escape handling, `aria-activedescendant`, and a polite live region announcing
the match count. `TripSheet` swaps its `<input id="trip-country">` for it and sends
`country_code`. A typed no-match is refused as a `TripDraftError` beside the field, joining
`collectTripDraftErrors`'s existing `TripField` union — the blocker is data with a message,
never a disabled Save.

### Slice C — US2: what follows from the country

`CURRENCY_BY_CODE` added to `lib/currencies.ts` and served as `by_code` on `/api/currencies`;
the trip sheet guesses from the code, still respecting `currencyPicked` and still leaving the
currency alone for a country the map does not cover. `isJapanTrip` gains an optional second
argument: a present code decides on its own (`JP` or not) and a missing one falls through to
the existing whole-word string match. Table-tested over both paths.
`src/lib/posthog.ts:164` passes the code through; no new property.

### Slice D — US3: the trips that came before

Opening a trip whose text names a list entry preselects that entry without writing anything;
text that matches nothing is shown as typed with a note that it is not a recognised country,
and survives a save of other fields untouched. Covered by a legacy free-text row in both
`server/tests/trips.test.ts` and `src/tests/trip-sheet.test.tsx`.

## The write contract, precisely

This is the part worth getting exactly right, because it is where "only a list entry saves"
either holds or leaks. Full detail in [contracts/countries.md](./contracts/countries.md).

- `country_code` is the field a client sets. It is uppercased, and must name an entry on the
  list; anything else is a `VALIDATION` error.
- The server writes `country` from that entry's name. A client never chooses the stored name.
- `country` may still be **sent**, and is accepted only when it exactly (trimmed,
  case-insensitively) names one list entry — which resolves to that entry, code and all. Any
  other non-empty string is refused with "country must be chosen from the list". This is what
  closes the free-text path without inventing a fuzzy match.
- Sending both, disagreeing, is a `VALIDATION` error rather than a silent winner.
- `null` on either field clears **both**. They are one answer in two columns.
- Omitting both leaves both untouched — the existing `PATCH` rule, and what the flight field
  already relies on.

## How this gets built: the code-quality contract

**Layering.** The list is a pure module (`lib/countries.ts`) with no Express and no store, the
route is four lines around it, and the validation lives in the service where every other trip
rule lives. The client mirrors it: `country-flag.ts` is pure, `CountryPicker.tsx` is a
controlled component that takes a list and a value and emits a selection, and `TripSheet` does
the wiring. Nothing in the picker knows about trips.

**One combobox, built once.** There is no typeahead in the repository today (the currency and
timezone fields are native selects, which is right for 30 rows and wrong for 200). The picker
is written as a self-contained component with the value type `{ code, name } | null`, so a
second use later — spec 010 has none, but the shape invites one — costs nothing.

**Accessibility is a test, not a comment.** The keyboard path (open, arrow, Enter, Escape) and
the announced match count are asserted in `src/tests/country-picker.test.tsx`. FR-014 is the
requirement most likely to be quietly skipped, so it gets its own file.

**Rollback.** Deleting the feature is: revert the `TripSheet` field, delete
`CountryPicker.tsx`, `country-flag.ts`, `countries.ts` and the route. The column stays
harmlessly behind — nothing reads a code it does not have, which is the same property that
makes Slice A safe to ship alone.

## Project Structure

### Documentation (this feature)

```text
specs/008-country-picker/
├── spec.md
├── plan.md              # this file
├── research.md          # the decisions that needed evidence
├── data-model.md        # Country, and the trip's two country columns
├── quickstart.md        # how to prove it works
├── contracts/
│   └── countries.md     # GET /api/countries + the trip write rules
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks output — not created here
```

### Source Code (repository root)

```text
server/src/
├── lib/
│   ├── countries.ts            # NEW — the list, COUNTRY_BY_CODE, findCountry
│   ├── currencies.ts           # + CURRENCY_BY_CODE (Slice C)
│   └── datastore.ts            # Trip.country_code, TripInput.country_code
├── routes/
│   └── countries.ts            # NEW — GET /api/countries
├── services/
│   └── trips.ts                # collectTripErrors + resolveCountry
├── lib/datastore.memory.ts     # country_code on create/patch
├── lib/datastore.supabase.ts   # TRIP_COLS, rowToTrip, create/patch
└── app.ts                      # mount countriesRouter beside ratesRouter

src/
├── api/
│   ├── hooks.ts                # useCountries()
│   └── types.ts                # Country, CountryCatalogue, Trip.country_code
├── components/
│   ├── CountryPicker.tsx       # NEW — the combobox
│   └── TripSheet.tsx           # the field, the currency guess, the save
├── lib/
│   ├── country-flag.ts         # NEW — code → 🇯🇵
│   ├── destination.ts          # isJapanTrip gains the code path
│   ├── trip-draft.ts           # 'country' joins TripField
│   └── posthog.ts              # trip_destination from the code

supabase/migrations/
└── 0023_trip_country_code.sql  # NEW — check main before merging

server/tests/
├── countries.test.ts           # NEW — the endpoint, and the currency-map guard
└── trips.test.ts               # code validation, refused free text, omitted PATCH

src/tests/
├── country-picker.test.tsx     # NEW — filtering, keyboard, announcements
├── trip-sheet.test.tsx         # picking, the no-match message, a legacy row
└── destination.test.ts         # the code path and the string path, table-tested
```

**Structure Decision**: The existing two-runtime layout is unchanged. Every new file sits in the
directory its neighbours already occupy; no new directory is created, and nothing here needs a
boundary of the kind `src/map/` has.

## Risks

| Risk                                                                                                                                                                                         | Mitigation                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The migration is committed but not run.** Production is Supabase; the deployed app would 500 on the first trip write that mentions the column while every test passes on the memory store. | Slice A ships and is applied before Slice B. The Supabase MCP `apply_migration` or the SQL editor runs it; the task list says so explicitly.                                            |
| **The migration number collides** with spec 005's chat tables if that lands first.                                                                                                           | `0022` is `itinerary_category` on main today, so `0023` is free. Re-check `main` immediately before merging and renumber if 005 got there first.                                        |
| **A country the currency map knows falls off the list**, silently losing a currency guess.                                                                                                   | The guard test in `server/tests/countries.test.ts` fails the build if any `CURRENCY_BY_COUNTRY` key stops resolving.                                                                    |
| **The list is unreachable** (cold function, no signal) and the field renders empty.                                                                                                          | The value shown comes from the trip, not the list; the list is only needed to filter. The picker renders its current selection and says the list is still loading rather than blanking. |
| **Flags render as letter pairs** on some desktop platforms.                                                                                                                                  | Known and accepted (Assumptions in the spec). The name is always shown beside the flag, so nothing depends on the glyph.                                                                |

## Complexity Tracking

No constitution gates to violate, and no complexity worth tracking: one new pure module, one
four-line route, one component, one nullable column.

## Post-Design Constitution Re-check

Re-checked after the design above. The one rule that needed a real decision is "a route is
access-checked by construction": `GET /api/countries` sits outside the trip-scoped router
deliberately — it returns no trip content, and mounting it under `/api/trips/:tripId` would
imply per-trip data it is not. It stays behind `authMiddleware` like every other endpoint but
`/api/health` and the reminder dispatch. Everything else falls out of existing patterns.
