import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { TEST_CODE, fixture } from './fixture.js'

process.env.TRIP_ACCESS_CODE = TEST_CODE
const app = createApp()
const auth = (r: request.Test) => r.set('Authorization', `Bearer ${TEST_CODE}`)

beforeEach(() => setDataStore(createMemoryStore(fixture())))

describe('GET /api/trip', () => {
  it('returns the journey skeleton: ordered steps, zone summaries, counts', async () => {
    const res = await auth(request(app).get('/api/trip'))
    expect(res.status).toBe(200)
    expect(res.body.trip.name).toBe('Test Trip')
    expect(res.body.steps.map((s: { position: number }) => s.position)).toEqual([1, 2])
    const tokyo = res.body.steps[0].zone
    expect(tokyo.name).toBe('Tokyo')
    expect(tokyo.place_counts).toEqual({ hotel: 1, attraction: 0, food: 1, shopping: 0, other: 0 })
    expect(res.body.trip_files_count).toBe(1)
  })
})

describe('GET /api/zones/:id', () => {
  it('returns zone with tips, files and counts', async () => {
    const res = await auth(request(app).get('/api/zones/zone-tokyo'))
    expect(res.status).toBe(200)
    expect(res.body.zone.name_ja).toBe('東京')
    expect(res.body.tips).toHaveLength(1)
    expect(res.body.tips[0].body).toBe('Get a Suica card')
    expect(res.body.place_counts.food).toBe(1)
  })

  it('404 for unknown zone', async () => {
    const res = await auth(request(app).get('/api/zones/zone-nope'))
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })
})

describe('GET /api/zones/:id/places', () => {
  it('lists places of a category with summary_line', async () => {
    const res = await auth(request(app).get('/api/zones/zone-tokyo/places?category=food'))
    expect(res.status).toBe(200)
    expect(res.body.places).toHaveLength(1)
    expect(res.body.places[0].name).toBe('Ramen Bar')
    expect(res.body.places[0].summary_line.length).toBeLessThanOrEqual(100)
  })

  it('returns empty list for a category with no places', async () => {
    const res = await auth(request(app).get('/api/zones/zone-kyoto/places?category=shopping'))
    expect(res.status).toBe(200)
    expect(res.body.places).toEqual([])
  })

  it('400 VALIDATION for a bad category', async () => {
    const res = await auth(request(app).get('/api/zones/zone-tokyo/places?category=nightlife'))
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
  })
})

describe('GET /api/places/:id', () => {
  it('returns full place detail with tips and files', async () => {
    const res = await auth(request(app).get('/api/places/place-ramen'))
    expect(res.status).toBe(200)
    expect(res.body.place.links[0].url).toBe('https://example.com')
    expect(res.body.tips[0].body).toBe('Cash only')
    expect(res.body.files[0].display_name).toBe('Menu photo')
  })

  it('404 for unknown place', async () => {
    const res = await auth(request(app).get('/api/places/place-nope'))
    expect(res.status).toBe(404)
  })
})
