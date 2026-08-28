# Phase 0 Research: Export the Trip

Eight decisions the design rests on. Each came out of reading this codebase, not out of general practice —
the rationale names the file that forced it where there is one.

---

## R1 — Where the projection runs: server, with the client rendering

**Decision**: `GET /api/trips/:tripId/export?detail=share|full` returns a JSON payload, already projected.
The client turns that payload into a file and never decides what is in it.

**Rationale**:

- The route mounts on `tripScopedRouter()` (`server/src/app.ts`), so membership is checked by construction
  and a 404-not-403 for someone else's trip comes free.
- `TripView` lives on the trip context server-side. Applying it there is the established enforcement point
  for every other route that returns a place.
- The field policy has to sit where the `Place` type is declared, or the compile error that enforces FR-011
  cannot fire. That is `server/src/lib/datastore.ts`.
- It matches the house rule in `CLAUDE.md`: where the client would have to recreate server logic to build a
  row, it gets the API to hand the row over instead.

**Alternatives considered**:

- *Assemble on the client from the existing query cache.* Rejected twice over: the cache only holds zones the
  traveller happened to browse, so a whole-trip export would be silently partial; and the field policy would
  be duplicated, which is the one thing this feature cannot afford.
- *Render the PDF server-side.* Rejected: it puts a document renderer inside a Hobby function with a duration
  ceiling, and it makes offline export impossible. Client rendering is a load-bearing choice, not an
  optimisation — noted as such so a future refactor does not "tidy" it onto the server.

---

## R2 — PDF: `jspdf` + `jspdf-autotable`, dynamically imported

**Decision**: `jspdf` with `jspdf-autotable`, imported dynamically from `src/export/pdf.ts`, using the core
Helvetica font with no embedded font file. Table of contents and page numbers via a two-pass render: lay the
body out recording each journey step's page, then insert the contents pages at the front and stamp
`Page n of m` in the footer.

**Rationale**:

- **Precache weight is the deciding number.** The lazy chunk is part of the Workbox precache manifest — which
  is exactly what makes offline export work — so its size is paid at install time by every device, not on
  first use. jsPDF + autotable is roughly 400 KB; pdfmake is roughly 1.4 MB, most of it the base64 Roboto
  bundle it needs because it cannot use core fonts.
- Dropping `name_ja` for this phase (spec Assumptions) is what makes core fonts sufficient: every place name
  and all 39 addresses are romaji, so there is no glyph to embed. The library choice and the CJK deferral are
  the same decision seen twice.
- The backlog item that brings `name_ja` back needs a subsetted font whichever library wins; `jsPDF.addFont`
  accepts one, so that door stays open.

**Alternatives considered**:

- *pdfmake* — automatic pagination, a built-in `toc`, and page numbers from a footer function would remove
  most of the two-pass code. Rejected on the megabyte, in a mobile-first PWA on a $0 budget. This is the
  closest call in the plan: if the two-pass TOC turns out to be fiddlier than budgeted, pdfmake is the
  fallback and the cost is install size, not correctness.
- *@react-pdf/renderer* — comparable weight to pdfmake, no TOC support. No advantage.
- *pdf-lib* — no layout engine; we would be writing pagination from scratch. Wrong altitude.

---

## R3 — DOCX and XLSX: chosen when phase 3 is scheduled, not now

**Decision**: Do not pick the DOCX and XLSX libraries in this plan. Record the shortlist and the constraint,
and choose at the start of phase 3.

**Rationale**: These are additive writers over a payload that will already be stable and tested, so nothing in
phases 1–2 depends on the choice. Deciding now would fix a dependency months before it is installed. Two
things should be weighed when it is made:

- The `xlsx` (SheetJS) package on the npm registry is no longer the maintained distribution. `exceljs` and
  `write-excel-file` are the realistic candidates; `exceljs` is the heavier of the two.
- **Spec 007 (Import) plans to read Office files client-side "with the libraries export already ships."** That
  is only true if the writer chosen here can also read. `exceljs` reads and writes; `write-excel-file` writes
  only; the `docx` package writes only, so DOCX *reading* will need `mammoth` in 007 regardless. Worth saying
  out loud now, because 007's plan currently assumes otherwise.

---

## R4 — The payload must reach the device before the signal goes

**Decision**: The export screen fetches its payload on mount through TanStack Query
(`['export', tripId, detail]`, `staleTime` 5 minutes). Additionally, the trip home issues one low-priority
background prefetch of both detail levels after first paint, guarded on `navigator.onLine`.

**Rationale**: FR-016 and SC-004 make offline export a requirement, and the Workbox rule for `/api` is
`NetworkFirst` — it serves a cached response offline, but only for a URL that has been fetched at least once.
Without the prefetch, the first export ever attempted on a train fails, which is the exact scenario the
feature is for. The payload is small enough for this to be cheap: roughly 8 KB at share detail and 25 KB at
full for a 39-place trip, against the several megabytes of photo frames the home screen already fetches.

**Alternatives considered**:

- *Fetch on demand only.* Simpler, and wrong at the one moment that matters.
- *Fold the export payload into the trip bundle.* Rejected: it makes every trip open pay for a rarely used
  feature, and it puts full-detail content into a response that many screens read.

---

## R5 — Two new `DataStore` reads

**Decision**: Add `listAllPlaces(tripId)` and `listAllTips(tripId)` to the `DataStore` interface and to both
backends.

**Rationale**: The interface as it stands has `listPlacesInZone(tripId, zoneId)` and
`listTips(tripId, parent)` — both per-parent. Assembling a full export for the real trip means 1 trip +
1 steps + 1 zones + 1 itinerary + 9 zone place reads + 48 tip reads ≈ **60 queries** in one serverless
invocation. Tests would pass instantly against the memory store and the deployed endpoint would crawl or time
out: the same class of failure `CLAUDE.md` warns about with unapplied migrations, arriving through
performance instead. With the two new reads it is five queries. No migration — these are new queries against
existing tables.

---

## R6 — The drift guard is a type, and the type must actually be checked

**Decision**: A `PLACE_FIELD_POLICY: Record<keyof Place, ExportLevel>` const (and the same for `Zone`,
`Trip`, `Tip`, `ItineraryItem`, `JourneyStep`) is the single place a field is admitted to an export. Adding a
column to `Place` therefore fails to compile until it is classified `'share' | 'full' | 'never'`. Because
Vitest transpiles types away without checking them, **add `"typecheck": "tsc --noEmit"` and run it alongside
`npm test`**.

**Rationale**: FR-011 asks for a test that fails when a new place field appears. A runtime test cannot see a
field that exists only in the TS interface, so the type is the only thing that can catch the real case — and
today nothing in the repo's test path type-checks, which would leave the requirement satisfied on paper and
inert in practice. Both guards are implemented, and they catch different things:

| Guard | Catches |
| --- | --- |
| `Record<keyof Place, ExportLevel>` + `tsc --noEmit` | a new column added to the type without a decision |
| Runtime: share projection key set is exactly `['name', 'address', 'category']` | an accidental spread, or a policy entry mis-set |

**Alternatives considered**: *A frozen snapshot test of the projected output.* It would catch both, and it
would also fail on every harmless content change, which is how a snapshot test gets updated without being
read.

---

## R7 — Delivery: generate, then hand over on a second tap

**Decision**: Tapping "Share with a friend" or "Full copy" generates the file and opens a result sheet with
**Share** and **Save** on it. Share uses `navigator.share({ files })` behind a `navigator.canShare({ files })`
guard; Save falls back to an object URL and a `download` link, the idiom already used in
`src/pages/DocumentPreview.tsx`.

**Rationale**: Web Share must be called inside a user gesture, and iOS Safari drops the transient activation
across the `await` that generating a PDF requires — calling share directly after generation throws
`NotAllowedError` on the one platform where sharing matters most. The second tap is not friction added; it is
the only reliable sequence. It still meets SC-002's two-tap budget: pick the version, then share.

---

## R8 — `trip_exported`, declared before it is called

**Decision**: Add to `AnalyticsEventProperties`:
`trip_exported: { format: 'pdf' | 'docx' | 'xlsx' | 'json'; detail: 'share' | 'full'; place_count: number; day_count: number; included_stays: boolean }`.

**Rationale**: `capture` is typed against that map, so the declaration has to come first or the call site will
not compile — which is the intended order. Every property is a shape: two enums, two counts and a flag.
Nothing here is trip content, so the sanitizer has nothing to drop; `included_stays` is a boolean about the
exporter's view, not about what any particular place is. Failures are reported through `captureError` on the
same pipe, which matters here because a failed export is silent by nature — the traveller sees no file and the
app, without this, sees nothing at all.
