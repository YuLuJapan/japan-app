# 002 — User accounts & trip sharing

Turns a single-tenant, access-code-gated trip companion into a multi-user app:
real accounts (Google OAuth + email/password), trips owned by people, and
per-trip sharing with `owner` / `partner` / `viewer` roles.

Status: **awaiting approval — no implementation yet.**

---

## 1. Where we're starting from

Five properties of today's codebase drive every decision below.

| Finding | Where | Consequence |
| --- | --- | --- |
| `zones` and `places` are a **global catalog** — `zones` has no `trip_id`, `places` hang off zones | `supabase/migrations/0001_init.sql`, `datastore.ts` | Every trip shares one place list. With users, this is a cross-tenant leak by construction. |
| ~8 route families are addressed by **bare resource id** (`/places/:id`, `/tips/:id`, `/files/:id`, `/itinerary/:id`, `/shopping/:id`, `/steps/:id`, `/reminders/:id`, `/zones/:id`) | `server/src/routes/*` | Each is an IDOR the moment more than one tenant exists. |
| `push_subscriptions` has **no user column**; dispatch broadcasts every due reminder to every device | `services/reminders.ts:158`, `datastore.ts` | Shipping accounts without fixing this leaks reminder titles across accounts. |
| `FLIGHT` is a **hardcoded module constant** (booking ref `AOXIUF`) served with every trip bundle | `lib/flight.ts`, `services/trips.ts` | Every new signup would receive the owners' real booking reference. |
| **No `country` field** exists anywhere in the schema | — | The auto-title needs a new source of truth. |

Two things already exist and are reused rather than rebuilt: Supabase Auth JWT
verification (`lib/supabaseAuth.ts`) and the browser Supabase client
(`src/lib/supabaseClient.ts`), both wired for magic-link owner sign-in.

### Decisions taken (approved)

1. **Zone belongs to a trip.** `zones.trip_id`; places and tips inherit scope through their zone.
2. **Access codes kept as deprecated compat** behind `LEGACY_ACCESS_CODES`, removed in phase 6.
3. **Viewer sees everything, read-only.** Role controls verbs, not content.
4. **Explicit `trips.country`** field feeds the auto-title.

---

## 2. Architecture

Six layers. Each one is a module boundary, not just a concept.

### Layer 1 — Identity: *who you are*

`authMiddleware` today does authentication **and** authorization. That coupling
is why a new route has to be guarded by hand. Split it:

```ts
// server/src/lib/identity.ts
export type Principal =
  | { kind: 'user'; userId: string; email: string }
  | { kind: 'legacy'; code: 'owner' | 'guest' }   // deprecated, phase 6 removes

export async function resolvePrincipal(
  token: string,
  verify: TokenVerifier = verifySupabaseJwt   // injectable — same idiom as PushSender
): Promise<Principal | null>
```

`authMiddleware` becomes **authentication only**: resolve `req.principal`, 401
if none, `next()`. It makes no content decisions at all.

**`profiles` table** mirrors `auth.users`:

```sql
create table profiles (
  id           uuid primary key,     -- = auth.users.id
  email        text not null unique,
  display_name text,
  avatar_url   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Why mirror rather than read `auth.users` directly: the app needs a display name
it controls (for the members list and the auto-title fallback), joining an app
table beats reaching into the `auth` schema, and the memory datastore needs an
equivalent so tests never touch Supabase. Upserted on first authenticated
request — no DB trigger, which keeps memory/Supabase parity.

**Token caching (do not skip).** Verifying a JWT is a network round-trip to
Supabase. Doing it per request adds latency to every call. A bounded in-process
TTL cache (60s, ~500 entries, keyed by token) fixes it; Vercel functions are
warm-reused, so the hit rate is high. Cache the *failure* too, briefly, so a
bad token can't be used to hammer Supabase.

### Layer 2 — Membership: *what you can reach*

```sql
create table trip_members (
  trip_id    text not null references trips(id)    on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  role       text not null check (role in ('owner','partner','viewer')),
  created_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);
create index trip_members_user_idx on trip_members (user_id);
```

Capability matrix, in one pure module (`lib/permissions.ts`) so no route ever
writes `role === 'owner'` inline:

| capability | owner | partner | viewer |
| --- | :-: | :-: | :-: |
| read trip content, documents, stays, flight | ✓ | ✓ | ✓ |
| create / edit / delete content | ✓ | ✓ | ✗ |
| edit trip dates, title, country | ✓ | ✓ | ✗ |
| invite & manage members | ✓ | ✗ | ✗ |
| delete trip | ✓ | ✗ | ✗ |
| leave trip | — | ✓ | ✓ |

```ts
export const canWrite = (r: TripRole) => r === 'owner' || r === 'partner'
export const canManageMembers = (r: TripRole) => r === 'owner'
export const canDeleteTrip = (r: TripRole) => r === 'owner'
```

**Invariant: every trip has at least one owner.** Enforced in the service —
the last owner cannot be demoted, removed, or leave. A trip with zero members
is invisible to everyone forever, so this is a data-integrity rule, not a
politeness.

### Layer 3 — Scope: *structural isolation*

Three reinforcing mechanisms. Any one alone is a promise; together they're a guarantee.

**3a. One nested router, one guard.**

```ts
const tripScoped = Router({ mergeParams: true })
tripScoped.use(requireTripAccess)     // resolves membership → req.tripAccess, 404 if none
app.use('/api/trips/:tripId', tripScoped)
```

Every content route moves onto `tripScoped`. A route added there is guarded by
construction — the same property CLAUDE.md already credits for writes ("any new
write endpoint is guest-proof automatically by virtue of its HTTP method").

The frontend **already** nests every page under `/trips/:tripId`
(`src/router.tsx`), so the client always has the trip id. That means we can also
delete `getDefaultTrip()` and the entire legacy singleton family — `/api/trip`,
`/api/itinerary`, `/api/shopping`, `/api/reminders`, `/api/files`, `/api/steps`
— which the multi-trip work left behind as a documented stopgap.

Resulting route map:

```
/api/health                        exempt
/api/reminders/dispatch            CRON_SECRET (unchanged)
/api/auth/session, /api/me         authenticated, no trip
/api/trips                         GET (mine) · POST (create)
/api/invites/:token                GET (preview) · POST (accept)
/api/push/**                       user-scoped, not trip-scoped
/api/geocode /api/images /api/rates
/api/translate /api/product-preview  stateless proxies, auth only

/api/trips/:tripId/…               ← requireTripAccess mounted ONCE
    ''                date-impact        steps/:id
    zones/:id         zones/:id/places   places/:id
    tips/:id          itinerary/:id      shopping/:id
    reminders/:id     files/:id          files/:id/content
    members           members/:userId    invites
```

**3b. Scope lives in the query, not in an `if`.** Every trip-owned DataStore
method takes `tripId` as its first argument:

```ts
getPlace(tripId: string, placeId: string): Promise<Place | null>
listTips(tripId: string, parent: {zone_id} | {place_id}): Promise<Tip[]>
deleteFile(tripId: string, fileId: string): Promise<boolean>
search(tripId: string, query: string): Promise<…>
listZones(tripId: string): Promise<Zone[]>
countPlacesByCategory(tripId: string, zoneId: string): Promise<…>
```

A forgotten scope check becomes a **TypeScript error**, not a code-review
question. Nesting alone doesn't cover `/trips/A/places/<place-in-B>` — this does.
~30 interface methods and 2 implementations; mechanical, but it's what makes the
isolation real rather than aspirational.

**3c. The cross-tenant sweep test.** `server/tests/tenancy.test.ts`, driven off
an exported route manifest:

- non-member → **404** on every trip-scoped route (404, not 403 — don't confirm the trip exists)
- viewer → **403** on every write (they know the trip exists; 403 is honest)
- `/trips/A/<resource-in-B>` → **404** for every resource kind

Because it iterates a manifest, **adding a route without registering it fails
the test**. That's the regression guarantee, and it costs one small file.

### Layer 4 — Sharing: invites

```sql
create table trip_invites (
  id          text primary key,
  trip_id     text not null references trips(id) on delete cascade,
  email       text,                              -- null = open link
  role        text not null check (role in ('partner','viewer')),
  token_hash  text not null unique,              -- sha256; plaintext never stored
  invited_by  uuid references profiles(id) on delete set null,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references profiles(id) on delete set null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
```

Flow: owner picks a role (+ optional email) → server mints 32 random bytes
(base64url), returns the **plaintext exactly once**, stores only the SHA-256 →
UI shows a copyable `https://…/invite/<token>` link → friend opens it, signs in
if needed, POSTs accept → `trip_members` row.

Deliberate choices:

- **No email infrastructure.** The link is shared over WhatsApp — consistent with the existing `mailto:` traveller pattern and the $0 free-tier constraint.
- **Email-bound when `email` is set** (must match the accepting user), open link otherwise.
- **Single-use, 14-day expiry, revocable.**
- `GET /api/invites/:token` returns a deliberately minimal preview — trip display title, inviter name, offered role. Not trip content: an unaccepted invite is not access.
- **Idempotent re-accept**: already a member → success, and never downgrade an existing higher role.
- Token is 256-bit, so no accept rate-limiting is warranted.

**`trips.people` and `trip_members` stay separate.** `people` is the display
roster (the names in the auto-title); `trip_members` is the access list. You
list your travel companion by name whether or not they ever sign in, and you may
share the trip with a friend who shouldn't appear in its title. The UI links the
two when an invited user's email matches a traveller entry.

### Layer 5 — The auto-title

- `trips.name` → **nullable** (currently `not null` with a `name is required` rule).
- `trips.country` → new nullable text.

```ts
// server/src/lib/trip-title.ts — pure, no I/O
export function displayTitle(trip: Pick<Trip,'name'|'people'|'country'>): string
```

| condition | result |
| --- | --- |
| `name` non-empty | `name` |
| names + country | `Alex and Sam in Japan` |
| country only | `Trip to Japan` |
| names only | `Alex and Sam's trip` |
| neither | `Untitled trip` |

`formatNames`: 1 → `Alex` · 2 → `Alex and Sam` · 3 → `Alex, Sam and Jo` · 4+ →
`Alex, Sam and 2 others`.

Computed **server-side** and returned as `display_title` on every trip payload,
alongside the raw `name`. One implementation; clients cannot drift. Names come
from `trips.people`, falling back to member display names only when `people` is
empty.

### Layer 6 — Cleanups this feature forces

1. **Push/reminder privacy (non-optional).** `push_subscriptions.user_id`; dispatch resolves due reminder → trip's members → their subscriptions via a new `listPushSubscriptionsForUsers(userIds)`. Without it, accounts ship with a cross-account notification leak.
2. **The hardcoded flight.** Move `FLIGHT` into `trips.flight jsonb`, seeded onto the legacy trip only. (A `trip_flights` table is the alternative if legs ever become individually editable; jsonb is one migration and zero new store methods, so start there.)
3. **`lib/guest-view.ts` deleted.** With "viewer sees everything," the `includeStays` / `includeFlight` / `includeFiles` plumbing threaded through six services disappears — a genuine simplification. It must survive until `LEGACY_ACCESS_CODES` goes, so this lands in phase 6, not before.

---

## 3. Migration & rollout

Live Supabase, **no migration runner**, real data in it. Check the highest
migration number on `main` before naming these (CLAUDE.md warns about parallel
branches claiming the same number).

| file | contents |
| --- | --- |
| `0010_profiles.sql` | profiles table + trigger |
| `0011_trip_members.sql` | members table + index |
| `0012_zone_trip_scope.sql` | **the risky one** — see below |
| `0013_trip_invites.sql` | invites table |
| `0014_trip_title_country.sql` | `name` drop-not-null, `country`, `flight jsonb` |
| `0015_push_user_scope.sql` | `push_subscriptions.user_id` |

**`0012` in four steps**, because a zone reachable from two trips can't simply
get one `trip_id`:

1. add `zones.trip_id` nullable
2. backfill zones reachable from exactly one trip (via `journey_steps`)
3. **duplicate** zones reachable from 2+ trips — and their places and tips with them
4. attach orphan zones (no step references them) to the oldest trip, then `set not null`

Step 3 needs a **dry-run report before it runs**, as an extension of the existing
`npm run check:db`: how many zones are shared, how many rows each duplication
would create.

**`scripts/backfill-members.ts`** reads `TRIP_OWNER_EMAILS`, resolves each
against `auth.users`, and inserts `owner` memberships for every existing trip.
Its post-condition is asserted, not assumed: **no trip may have zero members.**

**Order is load-bearing:** apply migrations → run backfill → verify the invariant
→ *then* deploy code. The new code requires memberships to exist; deploying it
first makes every existing trip invisible.

---

## 4. Frontend

| file | change |
| --- | --- |
| `src/lib/auth.tsx` *(new)* | `AuthProvider` — signed-in user, Supabase session, token refresh (the `onAuthStateChange` sync currently in `session.tsx` moves here), sign-out |
| `src/lib/session.tsx` → `trip-access.tsx` | `TripAccessProvider` keyed on `:tripId`, fed by `my_role` from `GET /api/trips/:tripId`. **`useCanEdit()` keeps its signature — call sites unchanged.** `useCanSeeBookings()` deleted |
| `src/pages/SignIn.tsx` | replaces `AccessGate`: Google button, email/password (sign-in · sign-up · reset), access code collapsed under a deprecated disclosure |
| `src/pages/TripMembers.tsx` *(new)* | invite (role picker + copy link), member list, role change, remove, leave |
| `src/pages/AcceptInvite.tsx` *(new)* | invite preview → sign in → accept |
| `src/router.tsx` | `RequireAuth` replaces `RequireAccess`; `RequireOwner` → `RequireWrite` (owner\|partner) plus `RequireTripOwner` for the members page; public `/invite/:token` |
| `src/api/client.ts` | bearer token from the Supabase session (legacy localStorage code path retained); 401 → `/signin` |

---

## 5. Testing

**Server** — new files:

- `tenancy.test.ts` — the manifest-driven cross-tenant sweep (§3c). The important one.
- `identity.test.ts` — JWT → principal, profile upsert, token cache hit/expiry, legacy-code compat
- `members.test.ts` — role matrix, last-owner invariant, leave
- `invites.test.ts` — mint · preview · accept · expire · revoke · email-bound · idempotent re-accept · plaintext-never-stored
- `trip-title.test.ts` — pure title rules

**Fixture upgrade** (`server/tests/fixture.ts`): gains `profiles`, `members`, and
a **second trip owned by a second user** with its own zone and place, plus
helpers `asUser(app, 'user-a')` / `asRole(...)`. This is what makes the sweep
test cheap to write and every existing test easy to update.

**No network in tests.** `resolvePrincipal` takes an injectable verifier —
the same dependency-injection idiom `dispatchDueReminders(store, now, send)`
already uses for `PushSender`. Reuse it rather than inventing a mock layer.

**Web** — `sign-in.test.tsx`, `members.test.tsx`, `invite-accept.test.tsx`,
`title.test.ts`; existing web tests mock `/auth/session` and `my_role`.

---

## 6. Phasing — six PRs, each green and deployable

| # | Phase | Ships | Risk | ~files |
| --- | --- | --- | :-: | :-: |
| 1 | **Identity** | profiles, Google + password sign-in, `req.principal`, `/api/me`. Access codes untouched | low | 8 |
| 2 | **Membership** | `trip_members`, `/api/trips` filtered to yours, `my_role`, backfill + invariant check | med | 10 |
| 3 | **Scope** | DataStore `tripId` args, nested router, `zones.trip_id`, delete `getDefaultTrip` + legacy routes, tenancy sweep | **high** | ~45 |
| 4 | **Sharing** | invites, members UI, role enforcement | low | 14 |
| 5 | **Title** | nullable `name`, `country`, `display_title` | low | 8 |
| 6 | **Cleanup** | push per-user, flight per-trip, remove access codes + `guest-view.ts` | med | 12 |

Phase 3 is the mechanical bulk and touches nearly every test — worth landing on
its own, with the sweep test written **first** so the refactor has a target.
Phase 5 has no dependency on 1–4 and can be pulled forward if you want a visible
win early.

---

## 7. Explicitly out of scope

Named so they don't creep in: organisations/teams, per-resource (rather than
per-trip) permissions, transactional email delivery, an audit log, and Postgres
RLS policies — the backend uses the service key and RLS stays deny-all, with the
app as the single authorization layer.
