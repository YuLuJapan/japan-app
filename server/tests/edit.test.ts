import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { fixture } from './fixture.js'
import { asOwner as auth, useTestTokens } from './auth.js'

const app = createApp()

beforeEach(() => {
  setDataStore(createMemoryStore(fixture()))
  useTestTokens()
})

describe('place mutations', () => {
  it('POST /api/places creates and it appears in the zone list', async () => {
    const res = await auth(request(app).post('/api/trips/trip-1/places')).send({
      zone_id: 'zone-kyoto',
      category: 'food',
      name: 'Matcha House',
      description: 'Green everything',
    })
    expect(res.status).toBe(201)
    expect(res.body.place.id).toBeTruthy()

    const list = await auth(
      request(app).get('/api/trips/trip-1/zones/zone-kyoto/places?category=food')
    )
    expect(list.body.places.map((p: { name: string }) => p.name)).toContain('Matcha House')
  })

  it('POST /api/places 400 on missing name and bad category', async () => {
    const res = await auth(request(app).post('/api/trips/trip-1/places')).send({
      zone_id: 'zone-kyoto',
      category: 'nightlife',
      name: '  ',
    })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
    expect(res.body.error.details.join(' ')).toMatch(/name is required/)
    expect(res.body.error.details.join(' ')).toMatch(/category/)
  })

  it('POST /api/places 404 for unknown zone', async () => {
    const res = await auth(request(app).post('/api/trips/trip-1/places')).send({
      zone_id: 'zone-nope',
      category: 'food',
      name: 'Ghost Cafe',
    })
    expect(res.status).toBe(404)
  })

  it('PATCH /api/trips/trip-1/places/:id updates fields (last write wins)', async () => {
    const res = await auth(request(app).patch('/api/trips/trip-1/places/place-ramen')).send({
      description: 'Updated notes',
    })
    expect(res.status).toBe(200)
    expect(res.body.place.description).toBe('Updated notes')
    expect(res.body.place.name).toBe('Ramen Bar')
  })

  it('PATCH rejects invalid link urls', async () => {
    const res = await auth(request(app).patch('/api/trips/trip-1/places/place-ramen')).send({
      links: [{ label: 'Bad', url: 'not-a-url' }],
    })
    expect(res.status).toBe(400)
  })

  it('DELETE /api/trips/trip-1/places/:id removes the place and cascades its tips', async () => {
    const del = await auth(request(app).delete('/api/trips/trip-1/places/place-ramen'))
    expect(del.status).toBe(204)

    const gone = await auth(request(app).get('/api/trips/trip-1/places/place-ramen'))
    expect(gone.status).toBe(404)
  })

  it('DELETE 404 for unknown place', async () => {
    const res = await auth(request(app).delete('/api/trips/trip-1/places/place-nope'))
    expect(res.status).toBe(404)
  })
})

describe('tip mutations', () => {
  it('POST /api/tips creates a zone tip', async () => {
    const res = await auth(request(app).post('/api/trips/trip-1/tips')).send({
      body: 'Buses fill up fast',
      zone_id: 'zone-kyoto',
    })
    expect(res.status).toBe(201)
    expect(res.body.tip.zone_id).toBe('zone-kyoto')
  })

  it('POST /api/tips 400 when both parents are set', async () => {
    const res = await auth(request(app).post('/api/trips/trip-1/tips')).send({
      body: 'Two parents',
      zone_id: 'zone-kyoto',
      place_id: 'place-ramen',
    })
    expect(res.status).toBe(400)
    expect(res.body.error.details.join(' ')).toMatch(/exactly one parent/)
  })

  it('POST /api/tips 400 when no parent is set', async () => {
    const res = await auth(request(app).post('/api/trips/trip-1/tips')).send({ body: 'Orphan' })
    expect(res.status).toBe(400)
  })

  it('PATCH /api/trips/trip-1/tips/:id updates the body', async () => {
    const res = await auth(request(app).patch('/api/trips/trip-1/tips/tip-zone')).send({
      body: 'Updated tip',
    })
    expect(res.status).toBe(200)
    expect(res.body.tip.body).toBe('Updated tip')
  })

  it('DELETE /api/trips/trip-1/tips/:id removes it; 404 when unknown', async () => {
    expect((await auth(request(app).delete('/api/trips/trip-1/tips/tip-zone'))).status).toBe(204)
    expect((await auth(request(app).delete('/api/trips/trip-1/tips/tip-zone'))).status).toBe(404)
  })
})
