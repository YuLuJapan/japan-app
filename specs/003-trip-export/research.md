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

- _Assemble on the client from the existing query cache._ Rejected twice over: the cache only holds zones the
  traveller happened to browse, so a whole-trip export would be silently partial; and the field policy would
  be duplicated, which is the one thing this feature cannot afford.
- _Render the PDF server-side._ Rejected: it puts a document renderer inside a Hobby function with a duration
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

- _pdfmake_ — automatic pagination, a built-in `toc`, and page numbers from a footer function would remove
  most of the two-pass code. Rejected on the megabyte, in a mobile-first PWA on a $0 budget. This is the
  closest call in the plan: if the two-pass TOC turns out to be fiddlier than budgeted, pdfmake is the
  fallback and the cost is install size, not correctness.
- _@react-pdf/renderer_ — comparable weight to pdfmake, no TOC support. No advantage.
- _pdf-lib_ — no layout engine; we would be writing pagination from scratch. Wrong altitude.

---

## R3 — DOCX and XLSX: `fflate` and the OOXML parts themselves

**Decision** _(taken at the start of phase 3, as this section said it would be)_: no document library. Both
formats are ZIP archives of XML, so `fflate` (~30 KB, one dependency, and it unzips as well as it zips)
writes both, with the handful of OOXML parts generated in `src/export/ooxml.ts` and shared by
`src/export/docx.ts` and `src/export/xlsx.ts`.

**Rationale**:

- **The same number decided R2, and it decides this.** These chunks sit in the Workbox precache manifest, so
  their weight is paid at install time by every device rather than on first use. `exceljs` alone is well over
  a megabyte; `docx` is a few hundred kilobytes more. Against that, the parts a _readable_ export actually
  needs are small and well-specified: a `.docx` is `[Content_Types].xml`, `_rels/.rels` and
  `word/document.xml`; a `.xlsx` adds a workbook and one sheet, with inline strings so there is no
  shared-strings table to maintain. This export writes paragraphs and rows — it does not need styles,
  themes, charts or a formula engine, which is what the libraries' weight buys.
- **It answers the reading requirement instead of deferring it.** Spec 007 (Import) plans to read Office
  files client-side "with the libraries export already ships". `fflate` unzips, so 007 gets the archive half
  for free in both formats, and what remains is parsing XML it can already reach — rather than `mammoth` for
  DOCX plus a second library for XLSX, which is where the shortlist below was heading.
- Neither writer reads the payload directly: both render `src/export/outline.ts`, the same outline the PDF
  renders, so a format cannot widen what is included (FR-014) even by accident.

**Alternatives considered**:

- _`exceljs`_ — reads and writes, and would have satisfied 007 on the spreadsheet side. Rejected on
  precache weight, the same call as pdfmake in R2 and for the same reason.
- _`write-excel-file` + `docx`_ — lighter than exceljs and pleasant to use, but write-only, both of them.
  That leaves 007 needing two more libraries for reading, so the pair is cheaper today and dearer twice over.
- _The `xlsx` (SheetJS) package on the npm registry_ — no longer the maintained distribution; not a
  candidate.

**What this costs**: the generated files are plain. A `.docx` of headings and paragraphs, a `.xlsx` of rows
with a header — no styling beyond bold headings and column widths. That is the right trade for a document
whose job is to be readable and editable by whoever receives it, and it is the thing to revisit first if
anyone asks for a formatted export.

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

- _Fetch on demand only._ Simpler, and wrong at the one moment that matters.
- _Fold the export payload into the trip bundle._ Rejected: it makes every trip open pay for a rarely used
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

| Guard                                                                          | Catches                                           |
| ------------------------------------------------------------------------------ | ------------------------------------------------- |
| `Record<keyof Place, ExportLevel>` + `tsc --noEmit`                            | a new column added to the type without a decision |
| Runtime: share projection key set is exactly `['name', 'address', 'category']` | an accidental spread, or a policy entry mis-set   |

**Alternatives considered**: _A frozen snapshot test of the projected output._ It would catch both, and it
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
