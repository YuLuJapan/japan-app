// The door: is this request from somebody, and which trips are theirs?
//
// Identity (lib/identity.ts) answers *who*; this turns that into the two facts
// every route downstream depends on, and nothing else. It makes no content
// decisions at all — what a member may see is `lib/trip-context.ts`, resolved
// per trip.
//
// This used to also carry a *global* role, because a single shared access code
// reached every trip and the only way to constrain it was a blanket "guest may
// not write, and sees no documents" rule applied by path and HTTP method. Both
// codes are gone. Every caller is an account now, so the question "may you
// write?" has no global answer — it is per trip, decided by a membership row,
// and asked at the one choke point in trip-context.ts.
import type { NextFunction, Request, Response } from 'express'
import { accessForUser, type AccessContext } from './access.js'
import { getDataStore } from './datastore.js'
import { ApiError } from './errors.js'
import { resolveUser, syncProfile, type AuthUser } from './identity.js'

declare module 'express-serve-static-core' {
  interface Request {
    /** Who the caller is. Set by authMiddleware on every non-exempt request. */
    user?: AuthUser
    /** Which trips this caller may reach, resolved once per request. */
    access?: AccessContext
  }
}

// /api/health is the keep-alive ping; /api/reminders/dispatch is called by the
// external scheduler and checks CRON_SECRET itself.
const EXEMPT_PATHS = new Set(['/api/health', '/api/reminders/dispatch'])

const unauthorized = () => new ApiError(401, 'UNAUTHORIZED', 'Sign in to continue')

/**
 * The signed-in account. Throws rather than returning null, so a route mounted
 * outside authMiddleware by mistake fails closed instead of quietly running
 * with nobody.
 */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized()
  return req.user
}

/** The caller's reachable trips. Fails closed for the same reason. */
export function accessOf(req: Request): AccessContext {
  if (!req.access) throw unauthorized()
  return req.access
}

export async function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  if (EXEMPT_PATHS.has(req.path)) return next()
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''

  const user = await resolveUser(token)
  if (!user) return next(unauthorized())

  const store = await getDataStore()
  // Bookkeeping only, and rate-limited to one write per user per 5 minutes.
  // Awaited so a request never races its own profile row (the membership read
  // below needs it to exist), but it swallows its own failures.
  await syncProfile(store, user)

  req.user = user
  req.access = await accessForUser(store, user.id)
  next()
}
