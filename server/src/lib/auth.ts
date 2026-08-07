// Shared-access-code auth (research R8): one code for both travelers, sent as
// a bearer token on every API call. Exempt: /api/health (cron),
// /api/auth/verify (the gate screen itself) and /api/reminders/dispatch, which
// is called by the external scheduler and checks CRON_SECRET itself.
//
// Two codes, two roles. TRIP_ACCESS_CODE is the travelers' code and can do
// everything; TRIP_GUEST_CODE (optional) is the code you hand to friends and
// gets a read-only view with no documents at all. Everything below is the
// enforcement — the frontend only hides buttons, it doesn't decide anything.
import type { NextFunction, Request, Response } from 'express'
import { ApiError, forbidden } from './errors.js'

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

/** Which role a bearer token buys, or null when it buys nothing. */
export function roleForToken(token: string): Role | null {
  if (!token) return null
  // Owner wins if someone sets both vars to the same value — never silently
  // downgrade the travelers.
  if (token === accessCode()) return 'owner'
  if (token === guestCode()) return 'guest'
  return null
}

export const isGuest = (req: Request) => req.role === 'guest'

export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  if (EXEMPT_PATHS.has(req.path)) return next()
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
  const role = roleForToken(token)
  if (!role) {
    return next(new ApiError(401, 'UNAUTHORIZED', 'Missing or invalid access code'))
  }
  req.role = role

  if (role === 'guest') {
    if (req.path === FILE_PREFIX || req.path.startsWith(`${FILE_PREFIX}/`)) {
      return next(forbidden('Trip documents are not part of the guest view'))
    }
    if (!READ_METHODS.has(req.method)) {
      return next(forbidden('This is a read-only guest view'))
    }
  }
  next()
}
