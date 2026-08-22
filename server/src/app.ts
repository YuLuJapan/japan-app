import express, { Router } from 'express'
import { authMiddleware } from './lib/auth.js'
import { errorMiddleware, notFound } from './lib/errors.js'
import { requireTripAccess } from './lib/trip-context.js'
import { authRouter } from './routes/auth.js'
import { filesTripRouter } from './routes/files.js'
import { geocodeRouter } from './routes/geocode.js'
import { healthRouter } from './routes/health.js'
import { imagesRouter } from './routes/images.js'
import { itineraryTripRouter } from './routes/itinerary.js'
import { meRouter } from './routes/me.js'
import { placesTripRouter } from './routes/places.js'
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
  router.use(placesTripRouter)
  router.use(tipsTripRouter)
  router.use(itineraryTripRouter)
  router.use(shoppingTripRouter)
  router.use(remindersTripRouter)
  router.use(filesTripRouter)
  router.use(searchTripRouter)
  // Last: its '/' routes would otherwise swallow nothing, but keeping the
  // bundle after the sub-resources makes the nesting read top-down.
  router.use(tripDetailRouter)
  return router
}

export function createApp() {
  const app = express()
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
  app.use('/api', authRouter)
  app.use('/api', meRouter)

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
