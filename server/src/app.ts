import express from 'express'
import { authMiddleware } from './lib/auth.js'
import { errorMiddleware, notFound } from './lib/errors.js'
import { authRouter } from './routes/auth.js'
import { filesRouter } from './routes/files.js'
import { healthRouter } from './routes/health.js'
import { itineraryRouter } from './routes/itinerary.js'
import { placesRouter } from './routes/places.js'
import { ratesRouter } from './routes/rates.js'
import { searchRouter } from './routes/search.js'
import { tipsRouter } from './routes/tips.js'
import { tripRouter } from './routes/trip.js'
import { zonesRouter } from './routes/zones.js'

export function createApp() {
  const app = express()
  // File uploads post a base64 blob, so /files needs a larger body than the rest.
  const bigJson = express.json({ limit: '8mb' })
  const smallJson = express.json({ limit: '256kb' })
  app.use((req, res, next) =>
    req.method === 'POST' && req.path === '/api/files'
      ? bigJson(req, res, next)
      : smallJson(req, res, next)
  )
  app.use(authMiddleware)

  app.use('/api', healthRouter)
  app.use('/api', authRouter)
  app.use('/api', tripRouter)
  app.use('/api', itineraryRouter)
  app.use('/api', zonesRouter)
  app.use('/api', placesRouter)
  app.use('/api', tipsRouter)
  app.use('/api', filesRouter)
  app.use('/api', searchRouter)
  app.use('/api', ratesRouter)

  app.use('/api', (_req, _res, next) => next(notFound('Endpoint')))
  app.use(errorMiddleware)
  return app
}
