# Research: Country picker

**Phase 0 output.** The spec left no `[NEEDS CLARIFICATION]` markers, so this file records the
decisions the plan had to make on its own, with what was rejected and why. Each one is a place
where a later reader is likely to propose the alternative again.

---

## 1. Where the country list lives

**Decision**: A hand-held table in `server/src/lib/countries.ts` — ISO-3166 alpha-2 code plus
English name — served by `GET /api/countries`, with no client-side copy.

**Rationale**: This is exactly the shape `server/src/lib/currencies.ts` already has, and for the
same reason stated in its own header comment: the list that fills the picker must be the list
that validates the write, or the two drift and a picker offers something the API refuses. 243
rows of `{ code, name }` is about 6 KB — one cached response, not a payload worth engineering
around.

**Alternatives considered**:

- **An npm package** (`i18n-iso-countries`, `world-countries`, `country-list`). Rejected: it
  adds a dependency and a bundle cost to solve a problem that is a static table, and the
  packages carry translations, currencies, calling codes and geometry this app has no use for.
  A dependency also has to be kept current for a list that changes roughly once a decade.
- **A constant in the client.** Rejected: the server must validate the code anyway (FR-008), so
  a client constant is a second copy by construction.
- **A database table.** Rejected: reference data nobody edits does not want a table, a migration
  per correction, or a seed script. It also would not survive the memory backend, which is what
  dev and every test run on.

---

## 2. The flag

**Decision**: Derived from the alpha-2 code as a regional-indicator pair, computed in
`src/lib/country-flag.ts`. Not sent by the API and not stored.

**Rationale**: Two code points from two letters. No assets, no bundle cost, no request, and
adding a country is a row rather than a row plus an image.

**Known gap, accepted rather than discovered later**: Windows renders regional indicators as the
two letters (`JP`), not a flag. The app is mobile-first and both phone platforms render them
properly; the name is always shown beside the flag, so nothing is lost when the glyph is not.

**Alternatives considered**: an SVG sprite or flag-icon CSS (~240 assets or a webfont for
decoration on one form field — rejected on weight); shipping a flag string per row from the API
(rejected: it is derivable, so it would be a second source of truth for the same fact).

---

## 3. What a write actually carries

**Decision**: The client sends `country_code`. The server writes `country` from its own list
entry. `country` may still be sent, but is accepted only when it exactly names one list entry
(trimmed, case-insensitive); any other non-empty string is refused. Either field set to `null`
clears both. Omitting both leaves both untouched.

**Rationale**: If the client sent the name, it could send any name, and "only a list entry
saves" would be a client-side promise. Deriving the name server-side makes it structural. The
narrow acceptance of `country` closes the free-text path without breaking a caller that sends a
correct name, and gives the exact-typed-name case (below) somewhere to land.

**Alternatives considered**:

- **Replace `country` with `country_code` outright.** Rejected: every existing row would need
  backfilling by guessing, which is the one outcome the spec forbids, and the trip title's
  fallback chain reads the text.
- **Accept whatever the client sends for both.** Rejected: a client is not a guard — the same
  reasoning that already validates currency codes against `lib/currencies.ts`.
- **Store only the code and render the name from the list at read time.** Tempting, and wrong
  here: legacy rows have a name and no code, so the read path needs the text column regardless.
  Keeping both stored means one read path rather than two.

---

## 4. An additive column

**Decision**: `alter table trips add column if not exists country_code text` with a
`char_length = 2` / uppercase check, nullable, nothing backfilled. Migration `0023`.

**Rationale**: `trips.country` keeps its meaning, its 80-character cap and every existing value,
so an unmigrated read path and an unrun migration are both survivable. A trip with text and no
code is not a broken row — it is every trip that exists today.

**Numbering**: `0022_itinerary_category.sql` is the highest on `main`; the board's brief predates
it and says `0022` is spec 005's chat tables, which are not on main. `0023` is free today.
Re-check `main` before merging: parallel branches otherwise both claim the number.

---

## 5. The control

**Decision**: A combobox written for this feature — a text input with `role="combobox"`, a
listbox of matches, arrow keys, Enter, Escape, `aria-activedescendant`, and a polite live region
announcing the match count.

**Rationale**: There is no typeahead in the repository to reuse; the currency and timezone
fields are native selects, which is the right control for 30 rows and the wrong one for 200 on a
phone. The behaviour needed here is small and well-specified, and a component that takes a list
and a value and emits a selection is ~120 lines.

**Alternatives considered**:

- **A native `<select>`** with 243 options. Rejected in the brief: unfiltered, it is worse on a
  phone than the text box it replaces.
- **`<input list>` + `<datalist>`.** Tempting for being free, and rejected: rendering is
  inconsistent across browsers, the value is still free text (so the guard would be entirely
  server-side, with no message beside the field), and it cannot show a flag beside a name.
- **A headless library** (Downshift, React Aria, Radix). Rejected on budget-of-dependencies
  grounds rather than quality: this is one field, and the accessibility behaviour it needs is
  the part that gets tested anyway.

---

## 6. Typing an exact country name and never opening the list

**Decision**: A complete, case-insensitive match against exactly one list entry resolves to that
country, and the field shows the flag and name to confirm it. Anything partial or ambiguous does
not resolve, and there is no fuzzy matching at all.

**Rationale**: Someone who types "Japan" in full and tabs away has told us which country they
mean, unambiguously. Refusing that would be pedantry. Guessing that "Jappan" means Japan is the
opposite error — it stores the wrong country with confidence — so the line is drawn at
"unambiguous exact match", which is a rule with no judgement in it.

---

## 7. The currency guess

**Decision**: Add `CURRENCY_BY_CODE` beside `CURRENCY_BY_COUNTRY` and serve it as `by_code` on
`GET /api/currencies`. The trip sheet guesses from the code. Re-keying the whole map on ISO
codes, and dropping its alias rows, is a separate task done after the picker works.

**Rationale**: The map has 76 keys, several of them aliases (`czechia` and `czech republic` both
→ `CZK`) that exist precisely because the input was free text. Codes make the aliases redundant,
but deleting them in the same change as the picker means a currency regression would hide inside
the feature that caused it. A guard test asserts every existing key still resolves to a country
on the list, so nothing can be lost quietly.

**On the ~123 countries the map does not cover**: picking one leaves the trip's currency exactly
as it was. Blanking it, or resetting it to a default, would be a worse answer than "we do not
know".

---

## 8. `isJapanTrip`

**Decision**: `isJapanTrip(country, code?)` — a present code decides alone (`JP` or not), a
missing one falls through to the existing whole-word string match. Table-tested over both paths.

**Rationale**: The code is a stronger fact than the string, so it must not be second-guessed by
the string: a trip whose code is `PT` is not Japan even if it is named "Japan reunion". Keeping
the string path is what lets today's trips keep working unchanged.

**Explicitly out of scope**: `src/pages/Journey.tsx:23` has a second, private definition of Japan
(`/\bjapan\b/i`, falling back to `trip.name`) gating the sushi hero. Collapsing the two is spec
010's foundational work. Doing it here would put an Essentials-shaped decision inside a spec
about a form field.

---

## 9. Where the endpoint mounts

**Decision**: A new `countriesRouter` in `server/src/routes/countries.ts`, mounted in `app.ts`
beside `ratesRouter` — under `authMiddleware`, outside `tripScopedRouter()`.

**Rationale**: It is reference data, like `GET /api/currencies`. Mounting it under
`/api/trips/:tripId` would give it an access check it does not need and imply per-trip data it is
not. A separate file rather than a third route on `rates.ts`, because that file is about
exchange rates and the currency list that supports them.

---

## 10. Caching and offline

**Decision**: `useCountries()` with `staleTime: Infinity`, mirroring `useCurrencies()`. No
persistence beyond what the service worker's `NetworkFirst` rule for `/api` already gives.

**Rationale**: The list is immutable for the life of a session and small. Offline, the field
still shows the country the trip carries — that value comes from the trip, not the list — and
the picker says the list is still loading rather than rendering as an empty box. The only thing
lost with no list and no cache is the ability to _change_ the country while offline, which is
acceptable for a field nobody edits on a train.
