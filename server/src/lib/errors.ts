// Error envelope per contracts/api.md: {"error":{"code","message"[,"details"]}}
import type { NextFunction, Request, Response } from 'express'

export type ErrorCode =
  'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION' | 'FILE_MISSING' | 'INTERNAL'

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode,
    message: string,
    public details?: string[]
  ) {
    super(message)
  }
}

export const notFound = (what = 'Resource') => new ApiError(404, 'NOT_FOUND', `${what} not found`)

export const forbidden = (message: string) => new ApiError(403, 'FORBIDDEN', message)

export const validation = (details: string[]) =>
  new ApiError(400, 'VALIDATION', 'Invalid request', details)

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>

/** Wraps async route handlers so rejections reach the error middleware. */
export const asyncHandler = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res, next).catch(next)
}

export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details && { details: err.details }) },
    })
    return
  }
  console.error(err)
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } })
}
