# Quickstart: proving the country picker works

**Phase 1 output.** How to validate each slice end to end. Everything here runs against the
memory backend — `npm run dev` with no `DATA_BACKEND` set — except the migration step, which is
the one thing tests cannot cover.

## Prerequisites

```bash
npm install
npm run dev          # web on :3000, API on :3001
```

Signing in needs Supabase Auth configured (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, the
`VITE_*` pair) — see `.env.example`. Without them the gate has no working button.

## The checks, in the order the slices ship

### Slice A — the list and the column

```bash
npx vitest run server/tests/countries.test.ts
npx vitest run server/tests/trips.test.ts
npm run typecheck
```

Expect: the endpoint answers 243 entries ordered by name, each with a two-letter uppercase code;
every key of `CURRENCY_BY_COUNTRY` resolves to a country on the list (the guard against a
currency guess disappearing); a trip saves with `country_code: 'JP'` and reads back with
`country: 'Japan'`; `country_code: 'XX'` is a 400 with `details`.

By hand, with a token in `$TOKEN`:

```bash
curl -s -H "Authorization: Bearer $TOKEN" localhost:3001/api/countries | head -c 200
```

**The migration is the step nothing above covers.** `supabase/migrations/0023_trip_country_code.sql`
must be run against the live project (Supabase SQL editor, or the Supabase MCP
`apply_migration`) before Slice B is deployed. Until it runs, production has no column: the tests
still pass, because they run on the memory store. Confirm with:

```sql
select column_name from information_schema.columns
where table_name = 'trips' and column_name = 'country_code';
```

### Slice B — picking a country

```bash
npx vitest run src/tests/country-picker.test.tsx
npx vitest run src/tests/trip-sheet.test.tsx
```

By hand, on `/trips`:

1. Open **Add a destination**. Type `jap`. → Japan is offered, with its flag.
2. Select it, save. → The trip carries Japan; reopening the sheet shows it selected.
3. Reopen, type `Jappan`, save. → The trip is **not** saved, and the message beside the field
   says the country must be chosen from the list. What you typed is still there.
4. Clear the field, save. → The trip has no country, and saves.
5. Keyboard only: Tab to the field, type `por`, `↓` to move through matches, `Enter` to choose,
   `Esc` to dismiss without choosing. Every step must work with no pointer.
6. With a screen reader (VoiceOver on iOS is the target platform): the field announces itself as
   a combobox, the match count is announced as it changes, and the highlighted option is read.

### Slice C — what follows from the country

1. Pick **Japan** on a trip whose currency you have not touched. → `JPY` is prefilled.
2. Pick **Portugal**. → `EUR`.
3. Choose a currency by hand, then change the country. → Your currency stands.
4. Pick a country the guess does not cover (e.g. **Bhutan**). → The currency is unchanged, not
   blanked.
5. Open **Essentials** on the Japan trip. → Visit Japan Web, Suica, Takkyubin, 110/119 and the
   phrasebook are present.
6. Open **Essentials** on the Portugal trip. → None of them, anywhere.

```bash
npx vitest run src/tests/destination.test.ts
```

### Slice D — a trip from before the picker

Seed a legacy row (the memory store reads `server/src/data/placeholder-data.json`, whose trip
carries free text today) and:

1. Open the trip sheet. → The text is matched to a list entry where the name matches exactly, and
   shown as typed with a note where it does not.
2. Save a date change without touching the country. → Neither `country` nor `country_code` moves.
3. Send a `PATCH` that omits the country entirely. → Same.
4. Confirm the trip's title still falls back to the country text.

## Before opening the PR

```bash
npm test            # both projects
npm run typecheck   # not optional — the export field policy is a type error
npm run lint
npm run build       # watch the entry chunk; the picker should not move it meaningfully
```

And update `specs/001-japan-trip-app/contracts/api.md` with `GET /api/countries`, the
`by_code` addition to `GET /api/currencies`, and the trip write rules. It is referenced from code
comments on both sides; a contract that lives only here is one nobody reads.
