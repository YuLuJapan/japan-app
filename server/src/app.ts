import express, { Router } from 'express'
import { authMiddleware } from './lib/auth.js'
import { chatTripRouter } from './routes/chat.js'
import { errorMiddleware, notFound } from './lib/errors.js'
import { requireTripAccess } from './lib/trip-context.js'
import { exportTripRouter } from './routes/export.js'
import { filesTripRouter } from './routes/files.js'
import { activitiesTripRouter } from './routes/activities.js'
import { geocodeRouter } from './routes/geocode.js'
import { healthRouter } from './routes/health.js'
import { imagesRouter } from './routes/images.js'
import { invitesRouter } from './routes/invites.js'
import { membersTripRouter } from './routes/members.js'
import { meRouter } from './routes/me.js'
import { productUrlRouter } from './routes/producturl.js'
import { pushRouter } from './routes/push.js'
import { ratesRouter } from './routes/rates.js'
import { remindersRouter, remindersTripRouter } from './routes/reminders.js'
import { searchTripRouter } from './routes/search.js'
import { shoppingTripRouter } from './routes/shopping.js'
import { stepsTripRouter } from './routes/steps.js'
import { tipsTripRouter } from './routes/tips.js'
import { translateRouter } from './routes/translate.js'
import { tripDetailRouter, tripRouter } from './routes/trip.js'
import { zonesTripRouter } from './routes/zones.js'

/**
 * Everything that belongs to one trip, behind a single access check.
 *
 * This is the point of the whole arrangement: `requireTripAccess` is applied
 * once, here, so a route added to this router is access-checked by
 * construction rather than by remembering to guard it. The alternative — what
 * the flat routes below still do — is a guard per handler, which is a guard
 * per handler someone can forget.
 */
export function tripScopedRouter() {
  const router = Router({ mergeParams: true })
  router.use(requireTripAccess)
  router.use(stepsTripRouter)
  router.use(zonesTripRouter)
  router.use(activitiesTripRouter)
  router.use(tipsTripRouter)
  router.use(shoppingTripRouter)
  router.use(remindersTripRouter)
  router.use(filesTripRouter)
  router.use(searchTripRouter)
  router.use(exportTripRouter)
  router.use(membersTripRouter)
  router.use(chatTripRouter)
  // Last: its '/' routes would otherwise swallow nothing, but keeping the
  // bundle after the sub-resources makes the nesting read top-down.
  router.use(tripDetailRouter)
  return router
}

/**
 * The headers that cost nothing and close whole classes of attack.
 *
 * Vercel serves the same set for the static app (`vercel.json` → headers), but
 * the API must not depend on the host it happens to be deployed behind: local
 * dev, a preview, or any future runtime gets them from here. Deliberately
 * *not* a full CSP — a `script-src` policy that has never been exercised
 * against the live Supabase/OAuth flow would fail closed on sign-in, which is
 * worse than the thin XSS surface React already gives us. `frame-ancestors` is
 * the half that can't break a fetch, so it is enforced.
 *
 * `'self'` rather than `'none'`, and that is load-bearing rather than a
 * loosening: a `blob:` document inherits the CSP of the page that created it,
 * so under `'none'` the document preview's own `<iframe src={objectUrl}>` was
 * an ancestor violation and PDFs rendered as a blank frame — while the same
 * blob opened full screen (no ancestors, nothing to check) was fine, which is
 * exactly how the bug looked. Same-origin framing is not the clickjacking
 * vector: an attacker frames from *their* origin, which `'self'` still refuses.
 */
function securityHeaders(_req: express.Request, res: express.Response, next: express.NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self'")
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  next()
}

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.use(securityHeaders)
  // File uploads post a base64 blob, so /files needs a larger body than the rest.
  // Matches both the legacy flat route and the trip-scoped one.
  const bigJson = express.json({ limit: '8mb' })
  const smallJson = express.json({ limit: '256kb' })
  const isFilesUpload = (path: string) =>
    path === '/api/files' || /^\/api\/trips\/[^/]+\/files$/.test(path)
  app.use((req, res, next) =>
    req.method === 'POST' && isFilesUpload(req.path)
      ? bigJson(req, res, next)
      : smallJson(req, res, next)
  )
  app.use(authMiddleware)

  app.use('/api', healthRouter)
  app.use('/api', meRouter)
  app.use('/api', invitesRouter)

  // Every content route. There is no flat equivalent any more: reaching trip
  // content without naming the trip is no longer expressible.
  app.use('/api/trips/:tripId', tripScopedRouter())

  // The trip collection (list/create) — not trip-scoped by definition.
  app.use('/api', tripRouter)

  app.use('/api', ratesRouter)
  app.use('/api', geocodeRouter)
  app.use('/api', imagesRouter)
  app.use('/api', productUrlRouter)
  app.use('/api', translateRouter)
  app.use('/api', remindersRouter)
  app.use('/api', pushRouter)

  app.use('/api', (_req, _res, next) => next(notFound('Endpoint')))
  app.use(errorMiddleware)
  return app
}
