# Phase 0 Research: Japan Trip Companion App

**Date**: 2026-07-11 | **Spec**: [spec.md](spec.md)

All provider limits below were verified against official pricing/docs pages on 2026-07-11 (links at bottom). The driving constraint is FR-014: total cost ≤ $5, so every choice targets $0.

## R1. Hosting platform (frontend + Node.js backend)

- **Decision**: Vercel Hobby plan — static React build + Node.js serverless functions in one deployment.
- **Rationale**: $0, no credit card, hard-capped (can never bill). Generous limits vs. our scale (100 GB transfer, 1M function invocations/month for 2 users). Serverless cold starts are ~0.5–2s, meeting SC-006 (3s content display), unlike Render's ~60s spin-up. Hobby's personal-use-only restriction is satisfied (private two-person app). Supports daily cron jobs (used for the Supabase keep-alive, R3).
- **Alternatives considered**:
  - **Render free**: rejected — web services spin down after 15 min idle with ~1 min cold start (kills mobile UX mid-trip), and free Postgres expires 30 days after creation (a trap for a multi-week trip).
  - **Netlify free**: rejected — new credit-based pricing (300 credits/month); production deploys cost 15 credits each, so ~20 deploys exhaust the month. Hostile to iterative building.
  - **Cloudflare Workers (runner-up)**: zero cold starts and huge allowances, but the API must target the Workers runtime (not vanilla Node/Express), and R2 activation requires a payment card. Kept as fallback if Vercel limits are ever hit.

## R2. Database + blob storage

- **Decision**: Supabase Free — Postgres (500 MB) for structured data + Supabase Storage (1 GB, private bucket with signed URLs) for pre-collected files.
- **Rationale**: One provider covers both the database and blob storage requirement (FR-007), halving moving parts. 500 MB DB is ~1000× our expected data (dozens of rows per table); 1 GB storage and 5 GB egress/month comfortably fit "a few hundred MB of files" viewed by two people. No credit card required; free tier is hard-capped at $0. Relational model fits the entity hierarchy (trip → steps → zones → places → tips/files) cleanly.
- **Alternatives considered**:
  - **MongoDB Atlas M0**: viable (512 MB, no pausing while in use, no card) but provides **no blob storage**, forcing a second provider for files. Also 100 ops/sec throttle and no backups. Rejected for extra moving parts, not capability.
  - **Cloudflare D1 + R2**: bigger allowances (5 GB DB, 10 GB files, free egress) but R2 needs a payment card and ties us to the Workers runtime. Rejected per R1.
  - **Vercel Blob**: 1 GB free, but keeps files on a separate lifecycle from the DB rows that reference them; Supabase Storage integrates with the same client/keys.

## R3. Supabase free-project pausing

- **Decision**: Accept the pause behavior; mitigate with a daily keep-alive — a Vercel cron job (Hobby allows daily crons) hitting a backend health endpoint that performs one trivial DB read. Export a DB + storage backup after the trip.
- **Rationale**: Supabase pauses free projects after ~1 week of inactivity. Daily trip usage alone prevents it, but the cron makes it deterministic (e.g., during the pre-trip lull between building and departure). If ever paused, restore is one click in the dashboard within a 90-day window — acceptable for a personal app.
- **Alternatives considered**: external pingers (cron-job.org, GitHub Actions) — work equally well; Vercel cron chosen because it lives in the same repo/deployment with zero extra accounts.

## R4. Backend shape (Node.js on Vercel)

- **Decision**: A single Express (Node.js) application exported through one Vercel serverless function (`api/index.ts`), with all routes under `/api/*`.
- **Rationale**: Satisfies the user's explicit "backend in Node.js serving all of these data" constraint with the most familiar idiom (Express routing/middleware), while deploying free on Vercel. One function = one cold start path, shared DB connection logic, and trivially runnable locally (`vercel dev` or plain `node`). The backend is the only holder of the Supabase service-role key; the browser never talks to Supabase directly.
- **Alternatives considered**:
  - **Per-route Vercel functions**: more idiomatic for Vercel but scatters middleware (auth, errors) and multiplies cold starts; unnecessary at this scale.
  - **supabase-js directly from the browser (no backend)**: cheapest possible, but violates the explicit Node.js backend requirement and would expose data-access logic client-side.

## R5. Frontend stack

- **Decision**: React 18 + TypeScript + Vite; Tailwind CSS for styling; React Router for navigation; TanStack Query for data fetching/caching.
- **Rationale**: Vite gives a small, fast static build (mobile-first, SC-006). Tailwind suits building the custom Japanese-inspired design system (FR-010) without a heavy component library that would fight the aesthetic. TanStack Query provides loading/error/retry states (FR-013) and response caching that keeps previously viewed content on screen during flaky connections (edge case: metro offline).
- **Alternatives considered**: Next.js (SSR unneeded for a private data app; static SPA + API is simpler); MUI/Ant (generic look contradicts FR-010); plain fetch + useEffect (re-implements caching/retry poorly).

## R6. Design language ("Japanese but modern")

- **Decision**: Custom lightweight design system: warm paper-white background, sumi-ink dark text, one accent (vermillion/shu-iro), generous whitespace (ma), thin rules, subtle grain; Japanese labels as decorative subtitles alongside English (e.g., "Journey 旅程"); category icons; system font stack + one display font (e.g., Zen Kaku Gothic via Google Fonts, free).
- **Rationale**: Meets FR-010 and the spec assumption (English content, Japanese-inspired modern aesthetic) with zero licensing cost and minimal font payload.
- **Alternatives considered**: full Japanese UI localization — excluded by spec assumption; heavy themed UI kits — bundle size and genericity.

## R7. Journey visualization

- **Decision**: Custom vertical timeline component (ordered steps, date ranges, current-step highlight computed from device date), each step tappable into its zone. No charting/diagram library.
- **Rationale**: FR-005/FR-006 ask for a _simple_ visualization; a bespoke ~100-line component renders on one scrollable mobile screen (SC-002) with zero dependency weight. Vertical suits phones.
- **Alternatives considered**: timeline/diagram libraries (react-chrono, mermaid) — 10–100× the code weight for less design control.

## R8. Access control (private two-traveler app)

- **Decision**: Single shared access code (environment variable on the backend). Client sends it as a bearer token on every API call after a one-time entry screen; stored in localStorage. All API routes except `/api/health` require it. Supabase RLS set to deny-all for anon so the DB is unreachable except through the backend.
- **Rationale**: Spec assumes "simple shared access, no per-user accounts". A shared code is one screen, zero cost, and keeps the data private (URLs alone reveal nothing). Signed URLs (short-lived) protect files.
- **Alternatives considered**: Supabase Auth with two accounts — free but adds signup/login flows the spec explicitly excludes; no auth at all — rejected: personal itinerary, hotel bookings and documents would be public to anyone with the URL.

## R9. Editing & sync (FR-015..FR-019)

- **Decision**: Standard REST mutations (POST/PATCH/DELETE) through the backend; last-write-wins at the row level; TanStack Query cache invalidation on mutation + refetch-on-focus so the other traveler sees changes on their next view (FR-018). Delete requires an in-app confirmation dialog (FR-017). Failed saves keep the form state and show a retry (FR-019) via mutation error handling.
- **Rationale**: Two cooperating users editing different things almost always; real-time sync (Supabase Realtime/websockets) is available free but adds complexity the spec doesn't require — "visible on next view" is the stated bar.
- **Alternatives considered**: Supabase Realtime subscriptions — deferred as a nice-to-have; optimistic concurrency (version columns) — overkill for 2 users, last-write-wins is the spec's stated edge-case resolution.

## R10. Testing

- **Decision**: Vitest everywhere. Backend: route tests with supertest against the Express app with a mocked/stubbed data layer. Frontend: Vitest + React Testing Library for key components (timeline highlighting, category browsing, edit forms, delete confirmation).
- **Rationale**: One test runner for both halves; supertest exercises the real routing/auth middleware; RTL covers the acceptance scenarios' UI side.
- **Alternatives considered**: Jest (slower, duplicate config next to Vite); Playwright E2E — deferred, manual quickstart validation covers E2E for a personal app.

## Verified sources

- Supabase pricing: https://supabase.com/pricing · pausing: https://supabase.com/docs/guides/platform/free-project-pausing
- MongoDB Atlas: https://www.mongodb.com/pricing · M0 limits: https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/
- Vercel Hobby: https://vercel.com/docs/plans/hobby · limits: https://vercel.com/docs/limits · blob: https://vercel.com/docs/vercel-blob/usage-and-pricing
- Netlify credits: https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/
- Render free: https://render.com/docs/free
- Cloudflare Workers: https://developers.cloudflare.com/workers/platform/pricing/ · R2: https://developers.cloudflare.com/r2/pricing/

**Cost conclusion**: Vercel Hobby ($0, no card) + Supabase Free ($0, no card) + free fonts/icons = **$0 total**, within the $5 ceiling (FR-014) with the full $5 as unused buffer.
