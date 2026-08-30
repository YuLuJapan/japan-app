---
description: 'Task list for the Country picker feature'
---

# Tasks: Country picker

**Input**: Design documents from `/specs/008-country-picker/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/countries.md](./contracts/countries.md), [quickstart.md](./quickstart.md)

**Tests**: Included. This repository ships 1103 tests and treats them as the contract (`CLAUDE.md`), and the board's spec-input names the files each slice needs. Tests come before the code they cover wherever that is honest. Two do not: T009 (the currency-map guard) and T033 (watching the export field policy refuse to compile) lock in behaviour rather than drive it — they are guards against a future change, and that is the point of them.

**Organization**: by user story, in the priority order the spec sets. The four delivery slices in `plan.md` map onto the phases as: Slice A = Phase 2, Slice B = Phase 3, Slice C = Phase 4, Slice D = Phase 5.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel — different files, no dependency on an incomplete task
- **[Story]**: the user story the task serves (US1–US3). Setup, Foundational and Polish carry no story label.
- Every task names the exact file it touches.

## Path Conventions

Web application, existing layout (`plan.md` → Project Structure): React SPA in `src/`, one Express app in `server/src/` served by `server/dev.ts` and `api/index.ts`, tests in `src/tests/` (jsdom) and `server/tests/` (node), migrations in `supabase/migrations/`.

Relative imports under `server/` carry explicit `.js` extensions. No semicolons, single quotes, 100 columns — run `npm run format` rather than hand-wrapping.

---

## Phase 1: Setup

**Purpose**: the one thing that has to be settled before a file is named.

- [x] T001 Confirm the migration number is still free: `git fetch origin main && git ls-tree origin/main --name-only supabase/migrations/`. `0022_itinerary_category.sql` is the highest today, so this feature takes **0023**. If spec 005's chat tables landed first, renumber to the next free one before writing T002.

**Checkpoint**: nothing has changed. This is a five-second check that prevents two branches claiming one number.

---

## Phase 2: Foundational — one list, one column (Slice A)

**Purpose**: the country list and somewhere to put the answer. **Blocks every story below.** Nothing user-visible ships in this phase.

- [x] T002 [P] Write `supabase/migrations/0023_trip_country_code.sql`: `alter table trips add column if not exists country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$')`. Head it with the comment every migration in this repo carries — what it is for, that nothing is backfilled, and that committing it is not deploying it.
- [x] T003 [P] Create `server/src/lib/countries.ts`: the `Country` interface (`code`, `name`), `COUNTRIES` (ISO-3166-1 alpha-2, 243 entries, ordered by name), `COUNTRY_BY_CODE`, `findCountryByCode(code)` and `findCountryByName(name)` — trimmed and case-insensitive, exact only, never guessing. Header comment states why it is served rather than bundled, mirroring `server/src/lib/currencies.ts`.
- [x] T004 Create `server/src/routes/countries.ts` exporting `countriesRouter` with `GET /countries` returning `{ countries: COUNTRIES }`, wrapped in `asyncHandler`. Comment says why it is not trip-scoped.
- [x] T005 Mount `countriesRouter` in `server/src/app.ts` beside `ratesRouter` — under `authMiddleware`, outside `tripScopedRouter()`.
- [x] T006 Add `country_code: string | null` to `Trip` and `country_code?: string | null` to `TripInput` in `server/src/lib/datastore.ts`, with a comment naming migration 0023 and the "text without a code is the ordinary legacy state" rule.
- [x] T007 [P] Carry `country_code` through `server/src/lib/datastore.memory.ts` — create (`input.country_code ?? null`) and patch (`if (patch.country_code !== undefined)`), matching how `country` is handled today.
- [x] T008 [P] Carry `country_code` through `server/src/lib/datastore.supabase.ts`: add it to `TRIP_COLS`, default it in `rowToTrip` the way `country` (0015) and `flight` (0017) are defaulted, and handle it in create and patch.
- [x] T009 Write `server/tests/countries.test.ts`: `GET /api/countries` returns 243 entries ordered by name, each code two uppercase letters and unique; 401 without a token; and **the guard** — every key of `CURRENCY_BY_COUNTRY` resolves through `findCountryByName`, so no country can lose its currency guess when the list changes (FR-004, SC-004).
- [x] T010 Add `resolveCountry(input)` to `server/src/services/trips.ts` implementing the write contract exactly as [contracts/countries.md](./contracts/countries.md) states it: uppercase and validate `country_code`; write `country` from the list entry; accept `country` only as an exact single-entry name; refuse anything else with `country must be chosen from the list`; refuse a disagreeing pair; `null` on either clears both; neither mentioned leaves both untouched. Errors join `collectTripErrors`'s array rather than throwing first.
- [x] T011 Apply `country_code` in `createTrip` and `updateTrip` in `server/src/services/trips.ts` via `resolveCountry`. The `COUNTRY_MAX` check goes with the free text it guarded — a name is now only ever written from our own list, whose longest entry is 44 characters, and the column's cap (0015) still stands behind it.
- [x] T012 Extend `server/tests/trips.test.ts`: a trip created with `country_code: 'jp'` reads back `JP` + `Japan`; `country_code: 'XX'` is a 400 `VALIDATION`; `country: 'Jappan'` is a 400 with the list message; `country: 'Japan'` resolves to `JP`; a disagreeing pair is a 400; `country: null` clears both; a `PATCH` omitting both leaves a legacy free-text row untouched.
- [x] T013 Classify `country_code` in `TRIP_FIELD_POLICY` (`server/src/lib/export-view.ts`) as `'never'` — the exported document already names the country in words. Until this is done `npm run typecheck` fails, which is the guard working.
- [ ] T014 **Apply migration 0023 to the live Supabase project** (SQL editor, or the Supabase MCP `apply_migration`), and confirm with `select column_name from information_schema.columns where table_name = 'trips' and column_name = 'country_code'`. Committing it is not deploying it, and every test passes without it because tests run on the memory store. Must be done before Phase 3 is deployed.

**Checkpoint**: `npm test`, `npm run typecheck`, `npm run lint` pass. The API serves the list and accepts a code; the app still shows a text box.

---

## Phase 3: US1 — pick my country from a list instead of typing it (P1)

> **T016, T017 and T020 were done during Phase 2**, ahead of the combobox: the
> API had started refusing free text, so the form needed to say so before the
> picker existed rather than after. The error, its message and the
> list-not-arrived rule are therefore already in place and tested
> (`src/tests/trip-draft.test.ts`, `src/tests/trip-sheet.test.tsx`); what is left
> here is the control itself.

**Goal**: the trip sheet's country field becomes a searchable list, and free text stops being saveable.

**Independent test**: open the trip sheet, type `jap`, select Japan with its flag, save, reopen and confirm it is selected. Type `Jappan` and confirm Save is refused with a message beside the field and the text is still there. Save a trip with no country at all.

- [ ] T015 [P] [US1] Create `src/lib/country-flag.ts`: `flagFor(code)` mapping two letters to their regional-indicator pair, returning the code itself for anything that is not two letters. Comment records the accepted Windows gap (research R2).
- [x] T016 [P] [US1] Add `Country` and `CountryCatalogue` to `src/api/types.ts`, and `country_code: string | null` to the `Trip` type beside `country`.
- [x] T017 [US1] Add `useCountries()` to `src/api/hooks.ts` — `queryKey: ['countries']`, `staleTime: Infinity`, mirroring `useCurrencies()`.
- [ ] T018 [US1] Create `src/components/CountryPicker.tsx`: a controlled combobox taking `countries`, `value: { code, name } | null`, `query`, and emitting selection and query changes. `role="combobox"` with `aria-expanded`, `aria-controls`, `aria-autocomplete="list"` and `aria-activedescendant`; a listbox of matches rendered as flag + name; `↓`/`↑` to move, `Enter` to choose, `Esc` to dismiss; a polite live region announcing the match count. Renders its current value and a "loading" state when the list has not arrived (FR-015). Knows nothing about trips.
- [ ] T019 [US1] Write `src/tests/country-picker.test.tsx`: typing filters; a no-match renders no options and announces zero; `↓`+`Enter` selects without a pointer; `Esc` dismisses without selecting; the flag and name both render; with an empty list the current value still shows. FR-014 is the requirement most likely to be quietly skipped, which is why it gets its own file.
- [x] T020 [US1] Add `'country'` to `TripField` in `src/lib/trip-draft.ts` and a `collectTripDraftErrors` rule: text typed that resolves to no country is a blocker with `when: 'missing'` and the message "Choose a country from the list". A blocker is data with a message beside the field, never a disabled Save.
- [ ] T021 [US1] Replace the `<input id="trip-country">` in `src/components/TripSheet.tsx` with `CountryPicker`: state becomes the selected `{ code, name } | null` plus the query string; `save()` sends `country_code` (or `null`) instead of `country`; the field shows `shownError('country')` like every other field.
- [ ] T022 [US1] Resolve an exactly-typed name on blur/save in `src/components/TripSheet.tsx` — a complete, case-insensitive match to one entry selects it (research R6). Partial or ambiguous does not resolve, and there is no fuzzy match anywhere.
- [ ] T023 [US1] Extend `src/tests/trip-sheet.test.tsx`: picking a country sends `country_code`; typing a no-match refuses the save and shows the message with the text intact; clearing the field sends `null`; a trip saves with no country at all; typing `Japan` in full and saving resolves to `JP`.

**Checkpoint**: US1 ships alone. A misspelled country cannot be stored from any route into the form, and the API refuses it even if the form is bypassed.

---

## Phase 4: US2 — the currency and the Japan advice follow the country I picked (P2)

**Goal**: what the app infers from the country stops depending on how it was spelled.

**Independent test**: pick Japan → JPY prefilled and the Japan-only Essentials cards present; pick Portugal → EUR and none of them; pick Bhutan → the currency is unchanged; choose a currency by hand first → it stands.

- [ ] T024 [P] [US2] Add `CURRENCY_BY_CODE: Record<string, string>` to `server/src/lib/currencies.ts` beside `CURRENCY_BY_COUNTRY`, covering every country the by-name map covers. Comment states that the by-name map stays for trips predating the code, and that re-keying it wholesale is T034.
- [ ] T025 [US2] Serve `by_code` from `GET /api/currencies` in `server/src/routes/rates.ts` — additive, so an older client is unaffected. Update `CurrencyCatalogue` in `src/api/types.ts` to match.
- [ ] T026 [US2] Change `onCountry` in `src/components/TripSheet.tsx` to guess from `by_code[selection.code]`, still returning early when `currencyPicked`, and still leaving the currency untouched when the code is not in the map (FR-018) — no blanking, no default.
- [ ] T027 [P] [US2] Give `isJapanTrip(country, code?)` its code path in `src/lib/destination.ts`: a present code decides alone (`JP` or not), a missing one falls through to the existing whole-word string match, which stays exactly as it is. Update the header comment to say which fact wins and why.
- [ ] T028 [P] [US2] Table-test both paths in `src/tests/destination.test.ts`: `('Japan', undefined) → true`, `('Jappan', undefined) → false`, `('Japan reunion', 'PT') → false`, `('Portugal', 'JP') → true`, `(null, 'JP') → true`, `(null, null) → false`.
- [ ] T029 [US2] Pass the code through at both call sites: `src/pages/TripEssentials.tsx:258` and `src/lib/posthog.ts:164`. `trip_destination` keeps its three values and **no new property is added** — `trip_country` already carries the grouping (FR-020).
- [ ] T030 [US2] Extend `src/tests/trip-sheet.test.tsx`: picking Japan prefills JPY, picking Portugal prefills EUR, picking a country outside the map leaves the currency alone, and a hand-picked currency survives a country change.

**Checkpoint**: US2 ships on top of US1. Nothing in Essentials changes for the Japan trip.

---

## Phase 5: US3 — open a trip I created before the picker existed (P3)

**Goal**: a new field does not strand old rows.

**Independent test**: open a trip whose country is free text; confirm it is matched to a list entry where the name matches exactly and shown as typed where it does not; save without touching it and confirm nothing moved.

- [ ] T031 [US3] Preselect from legacy text in `src/components/TripSheet.tsx`: on open, a `country` with no `country_code` that exactly names a list entry shows as selected **without writing anything** until the traveller saves. Text matching nothing shows as typed and is refused on save with the message every other unrecognised country gets — choose one, or empty the field (FR-023, FR-024, FR-024a). Partly done ahead of the combobox: the refusal and its message already work against the text input.
- [ ] T032 [US3] Extend `src/tests/trip-sheet.test.tsx` with a legacy row in both shapes: `country: 'Japan', country_code: null` opens preselected; `country: 'Tokyo', country_code: null` opens with the text and the note; saving a date change from either sends no country field at all, so nothing is rewritten.
- [ ] T033 [US3] Extend `server/tests/trips.test.ts`: a legacy free-text trip survives a `PATCH` that omits both fields; its `country` still drives the title fallback, the currency guess and `isJapanTrip`; and nothing anywhere writes a code onto it (FR-021).

**Checkpoint**: every trip that exists today opens, edits and saves exactly as it did.

---

## Phase 6: Polish & cross-cutting

- [ ] T034 [P] Re-key `CURRENCY_BY_COUNTRY` on ISO codes in `server/src/lib/currencies.ts`, dropping the alias rows that exist only because the input was free text, keeping the by-name map for legacy rows. Deliberately last: a currency regression must not be able to hide inside the feature that caused it (research R7). T009's guard is what makes this safe.
- [ ] T035 [P] Update `specs/001-japan-trip-app/contracts/api.md` with `GET /api/countries`, the `by_code` addition to `GET /api/currencies`, and the trip write rules — including the note that a PATCH omitting both fields leaves both untouched. It is referenced from code comments on both sides; a contract that lives only in a spec folder is one nobody reads.
- [ ] T036 [P] Add the country picker to `CLAUDE.md`'s Architecture section — one paragraph: one served list, the code as the value with the name derived server-side, additive columns, nothing backfilled, and that `Journey.tsx`'s second definition of Japan is deliberately left for spec 010.
- [ ] T037 Run `npm run format`, then `npm test`, `npm run typecheck`, `npm run lint` and `npm run build`. Confirm the entry chunk has not moved meaningfully — the list is ~6 KB of server data, not client bundle.
- [ ] T038 Walk `quickstart.md` by hand on a phone-width viewport, including the keyboard and screen-reader steps, which no test in this repository can prove.

---

## Dependencies

```text
T001 → Phase 2 (T002–T014)
Phase 2 → Phase 3 (US1) → Phase 4 (US2) → Phase 5 (US3) → Phase 6

T003 → T004 → T005
T006 → T007, T008
T003, T010 → T011 → T012
T014 gates deployment of Phase 3, not its development
T015, T016 → T017 → T018 → T019
T018, T020 → T021 → T022 → T023
T024 → T025 → T026
T027 → T028, T029
T009 → T034
```

US2 and US3 both build on US1's field, so they are sequential in practice. Within a phase, `[P]` tasks touch different files and can be done in any order.

## Parallel opportunities

- **Phase 2**: T002, T003 and (after T006) T007/T008 are four separate files.
- **Phase 3**: T015 and T016 are independent of each other and of everything before T017.
- **Phase 4**: T024 and T027/T028 are separate modules — the currency map and the destination test.
- **Phase 6**: T034, T035 and T036 touch three unrelated files.

## Implementation strategy

**MVP is Phase 2 + Phase 3** — the traveller's actual request, a list instead of a text box. It is shippable and valuable with Phases 4–6 unwritten.

Phase 4 is the payoff and Phase 5 is the safety net; neither changes what US1 does. Phase 6 is where the tidy-up lives that must not be smuggled into the feature.

**One ordering constraint is not negotiable**: T014 (applying the migration) precedes any deployment of Phase 3. Production runs on Supabase, so the first trip write that mentions `country_code` 500s without it — while every test still passes, because tests run on the memory store.
