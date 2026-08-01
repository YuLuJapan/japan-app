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

describe('GET /api/shopping', () => {
  it('returns the trip shopping list with unbought items first', async () => {
    const res = await auth(request(app).get('/api/shopping'))
    expect(res.status).toBe(200)
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual(['shop-shoes', 'shop-shampoo'])
    expect(res.body.items[0]).toMatchObject({
      name: 'Onitsuka Tiger Mexico 66',
      category: 'clothes',
      shop: 'Onitsuka Tiger Ginza',
      price_yen: 12000,
      bought: false,
    })
  })

  it('401 without a bearer token', async () => {
    const res = await request(app).get('/api/shopping')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })
})

describe('POST /api/shopping', () => {
  it('creates an item with photo, shop, price and zone', async () => {
    const res = await auth(
      request(app).post('/api/shopping').send({
        name: 'Uniqlo Heattech',
        category: 'clothes',
        note: 'Two of them, size M',
        shop: 'Uniqlo Ginza',
        zone_id: 'zone-tokyo',
        price_yen: 1500,
        image_url: 'https://example.com/heattech.jpg',
        url: 'https://uniqlo.com/heattech',
      })
    )
    expect(res.status).toBe(201)
    expect(res.body.item).toMatchObject({
      trip_id: 'trip-1',
      name: 'Uniqlo Heattech',
      category: 'clothes',
      shop: 'Uniqlo Ginza',
      zone_id: 'zone-tokyo',
      price_yen: 1500,
      image_url: 'https://example.com/heattech.jpg',
      bought: false,
    })

    const list = await auth(request(app).get('/api/shopping'))
    expect(list.body.items).toHaveLength(3)
  })

  it('defaults category to other and leaves optional fields null', async () => {
    const res = await auth(request(app).post('/api/shopping').send({ name: 'Kit Kats' }))
    expect(res.status).toBe(201)
    expect(res.body.item).toMatchObject({
      category: 'other',
      shop: null,
      price_yen: null,
      image_url: null,
      bought: false,
    })
  })

  it('400 VALIDATION for a missing name', async () => {
    const res = await auth(request(app).post('/api/shopping').send({ shop: 'Donki' }))
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
    expect(res.body.error.details).toContain('name is required')
  })

  it('400 VALIDATION collects every bad field at once', async () => {
    const res = await auth(
      request(app).post('/api/shopping').send({
        name: '',
        category: 'nonsense',
        price_yen: -5,
        image_url: 'not-a-url',
      })
    )
    expect(res.status).toBe(400)
    expect(res.body.error.details.length).toBeGreaterThanOrEqual(4)
  })

  it('404 for an unknown zone', async () => {
    const res = await auth(
      request(app).post('/api/shopping').send({ name: 'Something', zone_id: 'zone-nope' })
    )
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/shopping/:itemId', () => {
  it('marks an item as bought and re-sorts it to the bottom', async () => {
    const res = await auth(request(app).patch('/api/shopping/shop-shoes').send({ bought: true }))
    expect(res.status).toBe(200)
    expect(res.body.item.bought).toBe(true)

    const list = await auth(request(app).get('/api/shopping'))
    expect(list.body.items.every((i: { bought: boolean }) => i.bought)).toBe(true)
  })

  it('un-marks a bought item', async () => {
    const res = await auth(request(app).patch('/api/shopping/shop-shampoo').send({ bought: false }))
    expect(res.status).toBe(200)
    expect(res.body.item.bought).toBe(false)
  })

  it('updates price, shop and photo', async () => {
    const res = await auth(
      request(app)
        .patch('/api/shopping/shop-shoes')
        .send({ price_yen: 9800, shop: 'ABC Mart', image_url: 'https://example.com/shoe.png' })
    )
    expect(res.status).toBe(200)
    expect(res.body.item).toMatchObject({
      price_yen: 9800,
      shop: 'ABC Mart',
      image_url: 'https://example.com/shoe.png',
    })
  })

  it('400 VALIDATION for a bad price', async () => {
    const res = await auth(
      request(app).patch('/api/shopping/shop-shoes').send({ price_yen: 'cheap' })
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
  })

  it('404 for an unknown item', async () => {
    const res = await auth(request(app).patch('/api/shopping/shop-nope').send({ bought: true }))
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/shopping/:itemId', () => {
  it('removes the item', async () => {
    const res = await auth(request(app).delete('/api/shopping/shop-shoes'))
    expect(res.status).toBe(204)

    const list = await auth(request(app).get('/api/shopping'))
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual(['shop-shampoo'])
  })

  it('404 for an unknown item', async () => {
    const res = await auth(request(app).delete('/api/shopping/shop-nope'))
    expect(res.status).toBe(404)
  })
})
