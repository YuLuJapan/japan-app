// Auth: two static shared codes, plus (2026-08-08 addition) real owner
// sign-in via Supabase Auth email magic-link. Bearer token on every API call.
// Exempt: /api/health (cron), /api/auth/verify (the gate screen itself) and
// /api/reminders/dispatch, which is called by the external scheduler and
// checks CRON_SECRET itself.
//
// Owner vs guest, three ways in: TRIP_ACCESS_CODE (the travelers' static
// code) and a verified Supabase JWT whose email is in TRIP_OWNER_EMAILS both
// buy 'owner'; TRIP_GUEST_CODE (optional) buys 'guest' — a read-only view
// with no documents at all. Guests never get real accounts — magic-link only
// ever resolves to 'owner' or nothing. Everything below is the enforcement —
// the frontend only hides buttons, it doesn't decide anything.
import type { NextFunction, Request, Response } from 'express'
import { ApiError, forbidden } from './errors.js'
import { resolveOwnerEmail } from './supabaseAuth.js'

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by authMiddleware on every non-exempt request. */
    role?: Role
  }
}

export type Role = 'owner' | 'guest'

const EXEMPT_PATHS = new Set(['/api/health', '/api/auth/verify', '/api/reminders/dispatch'])

/** Guests never touch anything under here — not the list, not a single blob. */
const FILE_PREFIX = '/api/files'
/** Same block for the trip-scoped nested route (GET/POST /api/trips/:tripId/files). */
const TRIP_FILES_RE = /^\/api\/trips\/[^/]+\/files(\/|$)/

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function accessCode(): string {
  const code = process.env.TRIP_ACCESS_CODE
  if (code && code.trim()) return code.trim()
  // dev fallback so placeholder mode boots without any env; real deployments set the var
  return 'japan2026'
}

/** null when no guest code is configured — then there is simply no guest view. */
export function guestCode(): string | null {
  const code = process.env.TRIP_GUEST_CODE
  return code && code.trim() ? code.trim() : null
}

/** The travelers' emails, allow-listed for magic-link sign-in. Empty = nobody can sign in that way. */
function ownerEmails(): string[] {
  const raw = process.env.TRIP_OWNER_EMAILS ?? ''
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Which role a bearer token buys, or null when it buys nothing. Tries the two
 * static codes first (fast, synchronous), then — only if neither matched —
 * verifies the token as a Supabase Auth JWT and checks its email against
 * `TRIP_OWNER_EMAILS`. A token that is a valid Supabase session but whose
 * email isn't allow-listed buys nothing: guests don't get real accounts.
 */
export async function roleForToken(token: string): Promise<Role | null> {
  if (!token) return null
  // Owner wins if someone sets both vars to the same value — never silently
  // downgrade the travelers.
  if (token === accessCode()) return 'owner'
  if (token === guestCode()) return 'guest'
  const email = await resolveOwnerEmail(token)
  if (email && ownerEmails().includes(email.trim().toLowerCase())) return 'owner'
  return null
}

export const isGuest = (req: Request) => req.role === 'guest'

export async function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  if (EXEMPT_PATHS.has(req.path)) return next()
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
  const role = await roleForToken(token)
  if (!role) {
    return next(new ApiError(401, 'UNAUTHORIZED', 'Missing or invalid access code'))
  }
  req.role = role

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
