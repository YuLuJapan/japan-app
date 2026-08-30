# Data Model: Country picker

**Phase 1 output.** Two entities: a static list that lives in code, and two columns on a row
that already exists.

---

## Country (reference data, not a table)

`server/src/lib/countries.ts`. Immutable, served by `GET /api/countries`, never written.

| Field | Type | Notes |
| --- | --- | --- |
| `code` | `string` | ISO-3166-1 alpha-2, uppercase. The identity. |
| `name` | `string` | English name, as shown and as stored on the trip. |

```ts
export interface Country {
  code: string
  name: string
}

/** Every country a trip may name, ordered by name. */
export const COUNTRIES: Country[]

/** Uppercase code → entry. The lookup validation and reads go through. */
export const COUNTRY_BY_CODE: Record<string, Country>

/** A code, in any case, to its entry — or undefined. Never guesses. */
export function findCountryByCode(code: string): Country | undefined

/** An exact name (trimmed, case-insensitive) to its entry — or undefined. */
export function findCountryByName(name: string): Country | undefined
```

**The flag is not a field.** It is `String.fromCodePoint(...)` over the two letters of the code,
computed in `src/lib/country-flag.ts` at render time. Storing or serving it would make a
derivable fact into a second source of truth.

**Invariants**

- Codes are unique and uppercase; names are unique.
- Every key of `CURRENCY_BY_COUNTRY` resolves to exactly one entry by name (aliases included) —
  asserted by a test, so no country can lose its currency guess when the list changes.
- The list is ordered by name for display; nothing depends on the order.

---

## Trip (existing row, two columns for one answer)

| Column | Type | Existing? | Notes |
| --- | --- | --- | --- |
| `country` | `text`, nullable, ≤ 80 chars | yes (0015) | The name. Free text for every row written before this feature; the list's own name for every row written after it. Read by the trip title's fallback chain, the legacy currency guess and the legacy Essentials gating. |
| `country_code` | `text`, nullable, 2 uppercase letters | **new (0023)** | ISO-3166 alpha-2. Present only where a traveller picked from the list. Never backfilled. |

```sql
alter table trips
  add column if not exists country_code text
  check (country_code is null or country_code ~ '^[A-Z]{2}$');
```

### The three legitimate states

| `country` | `country_code` | Meaning |
| --- | --- | --- |
| `null` | `null` | No country. Everything country-derived answers the generic answer. |
| `'Japan'` | `'JP'` | Picked from the list. The code decides everything. |
| `'Tokyo'`, `'japan '`, `'Jappan'` | `null` | Written before the picker. The string paths still answer, exactly as today. |

A code with no name, or a name that disagrees with its code, is **not** a legitimate state, and
the write rules below are what make it unreachable rather than merely unlikely.

### Write rules (`services/trips.ts`)

1. `country_code` is uppercased and must name a list entry; otherwise
   `VALIDATION: country_code must be a country from the list`.
2. When `country_code` resolves, the server writes `country` from that entry's `name`. The
   client never chooses the stored name.
3. `country` may be sent. An exact (trimmed, case-insensitive) match to one entry resolves to
   that entry — code and name both written. Any other non-empty string is
   `VALIDATION: country must be chosen from the list`.
4. Both sent and disagreeing is `VALIDATION`, not a silent winner.
5. `null` on either clears **both**.
6. Neither mentioned leaves **both** untouched — the existing PATCH rule.
7. The 80-character cap on `country` stays, and stays enforced; no list name comes near it.

### Read shape

`country_code` joins the trip object every `GET` already returns — the bundle, the trips list,
and the response to a write. No new endpoint, no new shape, and no visibility rule: a country is
not booking metadata, so no `TripView` flag withholds it.

### Consumers, and what changes for each

| Consumer | Before | After |
| --- | --- | --- |
| `lib/trip-title.ts` fallback chain | `name → country → …` | unchanged |
| `CURRENCY_BY_COUNTRY` guess | lowercased name | code where present (`CURRENCY_BY_CODE`), name otherwise |
| `src/lib/destination.ts` `isJapanTrip` | whole-word string match | code where present, string match otherwise |
| `src/lib/posthog.ts` `trip_country` | lowercased name | unchanged — the grouping is still the name |
| `src/lib/posthog.ts` `trip_destination` | from `isJapanTrip(country)` | from `isJapanTrip(country, code)` |
| `src/export/` field policy | `country: 'share'` (or as classified) | `country_code` must be classified too — adding it to `Trip` is a **compile error** until it is, which is the guard working as designed |
