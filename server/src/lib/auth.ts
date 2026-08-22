// Authorization: what the caller resolved by lib/identity.ts is allowed to do.
// Identity answers *who*; this answers *what*. Bearer token on every API call.
// Exempt: /api/health (cron), /api/auth/verify (the gate screen itself) and
// /api/reminders/dispatch, which is called by the external scheduler and
// checks CRON_SECRET itself.
//
// Owner vs guest, three ways in: TRIP_ACCESS_CODE (the travellers' static
// code) and a signed-in account whose email is in TRIP_OWNER_EMAILS both buy
// 'owner'; TRIP_GUEST_CODE (optional) buys 'guest' — a read-only view with no
// documents at all. Everything below is the enforcement — the frontend only
// hides buttons, it doesn't decide anything.
//
// The email allow-list is a placeholder for per-trip membership (phase 2).
// Until then a signed-in account that isn't allow-listed authenticates fine and
// is then refused here, which is why `resolvePrincipal` returning a user and
// `roleForPrincipal` returning null are two separate outcomes.
import type { NextFunction, Request, Response } from 'express'
import { getDataStore } from './datastore.js'
import { ApiError, forbidden } from './errors.js'
import { resolvePrincipal, syncProfile, type Principal, type TokenVerifier } from './identity.js'

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by authMiddleware on every non-exempt request. */
    role?: Role
    /** Who the caller is, independent of what they may do. */
    principal?: Principal
  }
}

export type Role = 'owner' | 'guest'

const EXEMPT_PATHS = new Set(['/api/health', '/api/auth/verify', '/api/reminders/dispatch'])

/** Guests never touch anything under here — not the list, not a single blob. */
const FILE_PREFIX = '/api/files'
/** Same block for the trip-scoped nested route (GET/POST /api/trips/:tripId/files). */
const TRIP_FILES_RE = /^\/api\/trips\/[^/]+\/files(\/|$)/

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export { accessCode, guestCode } from './identity.js'

/** The travellers' emails, allow-listed for account sign-in. Empty = nobody can sign in that way. */
function ownerEmails(): string[] {
  const raw = process.env.TRIP_OWNER_EMAILS ?? ''
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

/** Which role a principal buys, or null when it buys nothing. */
export function roleForPrincipal(principal: Principal): Role | null {
  if (principal.kind === 'legacy') return principal.code
  return ownerEmails().includes(principal.user.email.trim().toLowerCase()) ? 'owner' : null
}

/**
 * Which role a bearer token buys, or null when it buys nothing. Used by
 * POST /api/auth/verify, which answers the same question without a request.
 */
export async function roleForToken(token: string, verify?: TokenVerifier): Promise<Role | null> {
  const principal = await resolvePrincipal(token, verify)
  return principal ? roleForPrincipal(principal) : null
}

export const isGuest = (req: Request) => req.role === 'guest'

/** The signed-in account, or null when the caller used a static access code. */
export const currentUser = (req: Request) =>
  req.principal?.kind === 'user' ? req.principal.user : null

export async function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  if (EXEMPT_PATHS.has(req.path)) return next()
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''

  const principal = await resolvePrincipal(token)
  const role = principal ? roleForPrincipal(principal) : null
  if (!principal || !role) {
    return next(new ApiError(401, 'UNAUTHORIZED', 'Missing or invalid access code'))
  }
  req.principal = principal
  req.role = role

  // Bookkeeping only, and rate-limited to one write per user per 5 minutes.
  // Awaited so a request never races its own profile row, but it swallows its
  // own failures — see syncProfile.
  if (principal.kind === 'user') await syncProfile(await getDataStore(), principal.user)

  if (role === 'guest') {
    if (
      req.path === FILE_PREFIX ||
      req.path.startsWith(`${FILE_PREFIX}/`) ||
      TRIP_FILES_RE.test(req.path)
    ) {
      return next(forbidden('Trip documents are not part of the guest view'))
    }
    if (!READ_METHODS.has(req.method)) {
      return next(forbidden('This is a read-only guest view'))
    }
  }
  next()
}
