import express from 'express'
import { authMiddleware } from './lib/auth.js'
import { errorMiddleware, notFound } from './lib/errors.js'
import { authRouter } from './routes/auth.js'
import { filesRouter } from './routes/files.js'
import { healthRouter } from './routes/health.js'
import { placesRouter } from './routes/places.js'
import { tipsRouter } from './routes/tips.js'
import { tripRouter } from './routes/trip.js'
import { zonesRouter } from './routes/zones.js'

export function createApp() {
  const app = express()
  app.use(express.json({ limit: '256kb' }))
  app.use(authMiddleware)

  app.use('/api', healthRouter)
  app.use('/api', authRouter)
  app.use('/api', tripRouter)
  app.use('/api', zonesRouter)
  app.use('/api', placesRouter)
  app.use('/api', tipsRouter)
  app.use('/api', filesRouter)

  app.use('/api', (_req, _res, next) => next(notFound('Endpoint')))
  app.use(errorMiddleware)
  return app
}
