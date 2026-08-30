# Contract: countries

**Phase 1 output.** One new endpoint, one additive field on an existing one, and the write rules
for the trip's country. `specs/001-japan-trip-app/contracts/api.md` is the source of truth for
the API as a whole and **must be updated with the same content when this ships** — that file is
referenced from code comments on both sides, and a contract that lives only in a spec folder is
a contract nobody reads.

---

## GET /api/countries

The countries a trip may name. Static, but served rather than duplicated in the client — the
list filling the trip sheet's picker is the same one that validates what it saves, exactly as
`GET /api/currencies` already is for currency codes.

- **Auth**: `authMiddleware` — any signed-in caller. Not trip-scoped: it returns no trip content,
  and mounting it under `/api/trips/:tripId` would imply per-trip data it is not.
- **Mounted**: `countriesRouter` in `server/src/routes/countries.ts`, beside `ratesRouter` in
  `server/src/app.ts`.
- **200**:

  ```json
  { "countries": [ { "code": "AF", "name": "Afghanistan" }, { "code": "JP", "name": "Japan" } ] }
  ```

  Ordered by `name`. Codes are ISO-3166-1 alpha-2, uppercase. **No flag field** — it is derived
  from the code on the device (`src/lib/country-flag.ts`).

- **401** `UNAUTHORIZED` with no valid bearer token, like every other endpoint.
- Immutable for the life of a deployment; the client caches it with `staleTime: Infinity`.

---

## GET /api/currencies (additive change)

The existing response gains one field. Nothing is removed, so an older client is unaffected.

```json
{
  "currencies": [ { "code": "USD", "name": "US Dollar" } ],
  "by_country": { "japan": "JPY", "czechia": "CZK", "czech republic": "CZK" },
  "by_code":    { "JP": "JPY", "CZ": "CZK" }
}
```

- `by_code` is what the trip sheet guesses from once a country is picked.
- `by_country` stays for trips that predate the code, and for the alias spellings that exist
  because the field was free text. Re-keying the map wholesale is a follow-up task, not part of
  this change.
- A country in neither map is not an error: the trip's currency is left exactly as it was.

---

## The trip's country, on write

Applies to `POST /api/trips` and `PATCH /api/trips/:tripId` alike, and is enforced in
`collectTripErrors` / the trip service — not in the form. The form's message is a convenience;
this is the guard.

### Fields

| Field | Type | Notes |
| --- | --- | --- |
| `country_code` | `string \| null` | ISO-3166 alpha-2, any case on the wire, uppercased on the way in. The field a client sets. |
| `country` | `string \| null` | Still accepted, but only as an exact name (see below). The server writes it from the list entry, so a client never chooses the stored name. |

### Rules

| Sent | Result |
| --- | --- |
| `country_code: "JP"` | `country_code = 'JP'`, `country = 'Japan'` — the name comes from the list. |
| `country_code: "jp"` | Same. Uppercased on the way in. |
| `country_code: "XX"` | **400 `VALIDATION`** — `country_code must be a country from the list`. |
| `country: "Japan"` | Resolves to the entry: `country_code = 'JP'`, `country = 'Japan'`. Exact, trimmed, case-insensitive, and only when it matches one entry. |
| `country: "Jappan"` / `"Tokyo"` / `"JP "` as a name | **400 `VALIDATION`** — `country must be chosen from the list`. No fuzzy match, no nearest neighbour. |
| `country_code: "JP", country: "Portugal"` | **400 `VALIDATION`** — the two disagree. Not a silent winner. |
| `country: null` **or** `country_code: null` | Both columns clear. They are one answer in two places. |
| Neither field present | Both untouched — the existing PATCH rule, and what the flight field already relies on. |
| `country_code` absent, `country` absent, trip has legacy text | Untouched. Nothing is backfilled, ever. |

Errors join `collectTripErrors`'s array rather than throwing on the first bad field, so a bad
country and a bad date arrive in one `details` list, as everywhere else.

### On read

`country_code` joins the trip object in every response that already carries `country` — the trip
bundle, the trips list, and the answer to a write. It is never withheld: a country is not booking
metadata, so no `TripView` flag applies to it.

`country_code` must also be classified in `TRIP_FIELD_POLICY`
(`server/src/lib/export-view.ts`) — adding it to `Trip` is a **type error** until someone decides
whether it travels. It should be `'never'`: the exported document already names the country in
words, and a code adds nothing a reader can use.
