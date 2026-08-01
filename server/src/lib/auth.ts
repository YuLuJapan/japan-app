// Shared-access-code auth (research R8): one code for both travelers, sent as
// a bearer token on every API call. Exempt: /api/health (cron),
// /api/auth/verify (the gate screen itself) and /api/reminders/dispatch, which
// is called by the external scheduler and checks CRON_SECRET itself.
import type { NextFunction, Request, Response } from 'express'
import { ApiError } from './errors.js'

const EXEMPT_PATHS = new Set(['/api/health', '/api/auth/verify', '/api/reminders/dispatch'])

export function accessCode(): string {
  const code = process.env.TRIP_ACCESS_CODE
  if (code && code.trim()) return code.trim()
  // dev fallback so placeholder mode boots without any env; real deployments set the var
  return 'japan2026'
}

export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  if (EXEMPT_PATHS.has(req.path)) return next()
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
  if (token !== accessCode()) {
    return next(new ApiError(401, 'UNAUTHORIZED', 'Missing or invalid access code'))
  }
  next()
}
