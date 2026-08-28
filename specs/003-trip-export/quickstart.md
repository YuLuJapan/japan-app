# Quickstart: Export the Trip

How to run this feature and prove it works. Written to be executed in order; each section states what you
should see, not how it is built.

## Prerequisites

```bash
npm install
npm run dev            # web on :3000, API on :3001
```

The default `DATA_BACKEND` is `memory`, seeded from `server/src/data/placeholder-data.json` — the real trip
content, 39 places across 9 zones. That is enough for every check below except the pagination one.

Signing in locally needs Supabase Auth configured (`.env.example`). Server-side checks below use supertest
and need none of it.

## The full check

```bash
npm test               # both projects
npm run typecheck      # NEW, and load-bearing — see below
npm run lint
```

**`npm run typecheck` is not optional for this feature.** Vitest transpiles types without checking them, so
the field-policy guard (FR-011) is inert unless `tsc --noEmit` runs. Verify the guard actually bites:

```bash
# add a column to Place in server/src/lib/datastore.ts, e.g.  phone: string | null
npm run typecheck      # MUST fail: PLACE_FIELD_POLICY is missing 'phone'
```

If that command passes, the guard is not wired up and the share export is unprotected — that is the single
most important line in this file.

## Validating each story

### US1 — the share export (P1)

**Server, the projection:**

```bash
npx vitest run server/tests/export-view.test.ts
npx vitest run server/tests/export.test.ts
```

Expected: a share projection of a place whose every field is populated emits exactly `name`, `address`,
`category` — no `description`, no `links`, no `summary_line`, no `id`. See
[data-model.md](./data-model.md) §1 for the policy the tests are asserting.

**By hand:**

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  'http://127.0.0.1:3001/api/trips/<tripId>/export?detail=share' | jq
```

Expected: the envelope in [contracts/export-api.md](./contracts/export-api.md), journey steps in order, and
**no** `description` / `links` / `tips` / `days` content anywhere. Grep it against yourself:

```bash
curl -s ... | jq -r '..|strings' | grep -i -e 'booking' -e 'confirmation' -e 'reservation'
```

Expected: no matches, against a trip whose hotel descriptions contain all three words.

**In the app:** open a trip → Export → "Share with a friend" → a PDF is produced → the result sheet offers
Share and Save. Open the PDF: a contents page listing the journey steps, then one section per step, each
place a name, an address and a category. Nothing you typed about a place is in it.

### US2 — the full copy (P2)

Same route with `detail=full`. Expected: descriptions, links, tips and the day plan present; and still no
flight, no shopping list, no documents and no member names — for an owner too (FR-004a). The test
`export.test.ts` covers that with an owner and a fully populated trip, which is the case that would otherwise
be assumed safe.

### US3 / US4 — formats and backup (P3)

Export the same trip as DOCX, XLSX and JSON at the same detail level. Expected: identical content to the PDF;
the JSON additionally carries `id` fields, and only the JSON does.

## The checks that are easy to skip and shouldn't be

**A viewer's export.** Add a viewer with `can_see_stays: false`, sign in as them, export both versions.
Expected: no hotel anywhere in the file, no tip that belonged to one, no day-plan row linking to one,
`stats.included_stays: false`, and the place count excludes the stays. There must be no line saying anything
was withheld.

**Offline.** Open the trip online, then switch the device to airplane mode (or DevTools → Network → Offline)
and export. Expected: it works. If it does not, the trip home's background prefetch is not running — that
prefetch is the whole of the offline guarantee (research R4).

**A long trip.** Not coverable with the seed data: it has 39 places and the requirement is ~120 (SC-003).
Generate a trip at 3× scale before signing this off, and check the contents page still lists every step, the
page numbers are right, and nothing overflows a page.

**A place with no address.** Expected: the place is listed by name, and the export reports how many such
places there are. A blank row with no explanation is the failure.

**A failed export.** Break the payload request (stop the API, or return a 500) and export. Expected: a
message that says so. A spinner that stops, or an empty file, is the failure (FR-020).

**Determinism.** Export the same trip twice at the same detail and diff the payloads (ignoring
`generated_at`). Expected: identical.

## What you should not find

- No new migration in `supabase/migrations/` — this feature adds none, deliberately.
- No meaningful change to the entry bundle: `npm run build` puts the PDF writer and the other three in their
  own lazy chunks, and the entry chunk grows only by the export screen (~8 KB gzip).

  The "~157 KB gzip" this line used to quote was already stale before this feature: the entry chunk measures
  **225.59 KB gzip on `main`** and **233.17 KB** with the export, so that is the number to compare against.
  `CLAUDE.md` has been corrected too.

- Every `src/export/` chunk **is** in the Workbox precache manifest (`grep assets/ dist/sw.js`) — that is
  what makes an offline export work, so its absence is a bug rather than a saving. jsPDF's `html2canvas`,
  `canvg` and `dompurify` chunks are deliberately _not_: nothing here can reach them, and precaching them
  would cost every phone ~380 KB at install (`globIgnores` in `vite.config.ts`).
