import express from 'express'
import { authMiddleware } from './lib/auth.js'
import { errorMiddleware, notFound } from './lib/errors.js'
import { authRouter } from './routes/auth.js'
import { filesRouter } from './routes/files.js'
import { geocodeRouter } from './routes/geocode.js'
import { healthRouter } from './routes/health.js'
import { imagesRouter } from './routes/images.js'
import { itineraryRouter } from './routes/itinerary.js'
import { meRouter } from './routes/me.js'
import { placesRouter } from './routes/places.js'
import { productUrlRouter } from './routes/producturl.js'
import { pushRouter } from './routes/push.js'
import { ratesRouter } from './routes/rates.js'
import { remindersRouter } from './routes/reminders.js'
import { searchRouter } from './routes/search.js'
import { shoppingRouter } from './routes/shopping.js'
import { stepsRouter } from './routes/steps.js'
import { tipsRouter } from './routes/tips.js'
import { translateRouter } from './routes/translate.js'
import { tripRouter } from './routes/trip.js'
import { zonesRouter } from './routes/zones.js'

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
  app.use('/api', tripRouter)
  app.use('/api', itineraryRouter)
  app.use('/api', stepsRouter)
  app.use('/api', zonesRouter)
  app.use('/api', placesRouter)
  app.use('/api', tipsRouter)
  app.use('/api', shoppingRouter)
  app.use('/api', filesRouter)
  app.use('/api', searchRouter)
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
