// Authorization: what the caller resolved by lib/identity.ts is allowed to do.
// Identity answers *who*; this answers *what*. Bearer token on every API call.
// Exempt: /api/health (cron), /api/auth/verify (the gate screen itself) and
// /api/reminders/dispatch, which is called by the external scheduler and
// checks CRON_SECRET itself.
//
// Two things are decided here, and they are no longer the same question.
//
// 1. `req.role` — the *global* verb check that predates accounts: 'owner' may
//    write, 'guest' (the optional TRIP_GUEST_CODE) may not, and sees no
//    documents. Every signed-in account is 'owner' in this sense; it says
//    nothing about *whose* trip they are writing to.
// 2. `req.access` — *which trips* this caller can reach at all. For an account
//    that is their membership list; for the deprecated static codes it is
//    every trip, exactly as before membership existed.
//
// TRIP_OWNER_EMAILS is gone. It was the allow-list that made this a two-person
// app: anyone can now register, and sees nothing until they create a trip or
// are invited to one. What used to be "is this email one of the travellers?"
// is now "is this account a member of this trip?", asked per trip in
// lib/access.ts rather than once at the door.
import type { NextFunction, Request, Response } from 'express'
import { LEGACY_ACCESS, accessForUser, type AccessContext } from './access.js'
import { getDataStore } from './datastore.js'
import { ApiError, forbidden } from './errors.js'
import { resolvePrincipal, syncProfile, type Principal, type TokenVerifier } from './identity.js'

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by authMiddleware on every non-exempt request. */
    role?: Role
    /** Who the caller is, independent of what they may do. */
    principal?: Principal
    /** Which trips this caller may reach, resolved once per request. */
    access?: AccessContext
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

/**
 * Which role a principal buys. Any signed-in account is an 'owner' in the
 * global sense — it may write *to its own trips*. Which trips those are is
 * `req.access`, not this.
 */
export function roleForPrincipal(principal: Principal): Role | null {
  return principal.kind === 'legacy' ? principal.code : 'owner'
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

/**
 * The caller's reachable trips. Throws rather than defaulting, so a route
 * mounted outside authMiddleware by mistake fails closed instead of quietly
 * getting the legacy see-everything context.
 */
export function accessOf(req: Request): AccessContext {
  if (!req.access) throw new ApiError(401, 'UNAUTHORIZED', 'Missing or invalid access code')
  return req.access
}

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

  if (principal.kind === 'user') {
    const store = await getDataStore()
    // Bookkeeping only, and rate-limited to one write per user per 5 minutes.
    // Awaited so a request never races its own profile row (the membership
    // read below needs it to exist), but it swallows its own failures.
    await syncProfile(store, principal.user)
    req.access = await accessForUser(store, principal.user.id)
  } else {
    req.access = LEGACY_ACCESS
  }

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
