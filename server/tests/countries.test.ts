import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { CURRENCY_BY_COUNTRY } from '../src/lib/currencies.js'
import { COUNTRIES, findCountryByCode, findCountryByName } from '../src/lib/countries.js'
import { fixture } from './fixture.js'
import { OWNER_BEARER } from './auth.js'
import { useTestTokens } from './auth.js'

const app = createApp()

beforeEach(() => {
  setDataStore(createMemoryStore(fixture()))
  useTestTokens()
})

describe('the country list', () => {
  it('serves every country, with a code and a name', async () => {
    const res = await request(app).get('/api/countries').set(OWNER_BEARER)
    expect(res.status).toBe(200)
    expect(res.body.countries.length).toBe(COUNTRIES.length)
    expect(res.body.countries).toContainEqual({ code: 'JP', name: 'Japan' })
    for (const country of res.body.countries) {
      expect(country.code).toMatch(/^[A-Z]{2}$/)
      expect(country.name.length).toBeGreaterThan(0)
    }
  })

  it('carries no flag: it is two code points derived from the code', async () => {
    const res = await request(app).get('/api/countries').set(OWNER_BEARER)
    expect(Object.keys(res.body.countries[0])).not.toContain('flag')
  })

  it('is ordered by name, which is the order the picker shows', async () => {
    const names = COUNTRIES.map((c) => c.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')))
  })

  it('holds each code once', () => {
    const codes = COUNTRIES.map((c) => c.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('refuses a caller with no token', async () => {
    const res = await request(app).get('/api/countries')
    expect(res.status).toBe(401)
  })

  // The guard. CURRENCY_BY_COUNTRY is keyed on the free text people used to
  // type, aliases and all ('czech republic', 'uae', 'england'), and every one of
  // those keys has to keep naming a country here — otherwise picking a country
  // from the list would silently lose a currency guess that typing it had.
  it('keeps every country the currency guess knows', () => {
    const orphans = Object.keys(CURRENCY_BY_COUNTRY).filter((key) => !findCountryByName(key))
    expect(orphans).toEqual([])
  })

  it('matches a name or an alias, trimmed and in any case — and nothing else', () => {
    expect(findCountryByName(' japan ')?.code).toBe('JP')
    expect(findCountryByName('UK')?.code).toBe('GB')
    expect(findCountryByName('Czech Republic')?.code).toBe('CZ')
    expect(findCountryByName('Jappan')).toBeUndefined()
    expect(findCountryByName('Jap')).toBeUndefined()
    expect(findCountryByName('Tokyo')).toBeUndefined()
    expect(findCountryByName('')).toBeUndefined()
  })

  it('matches a code in any case, and nothing that is not one', () => {
    expect(findCountryByCode('jp')?.name).toBe('Japan')
    expect(findCountryByCode(' JP ')?.name).toBe('Japan')
    expect(findCountryByCode('XX')).toBeUndefined()
    expect(findCountryByCode(null)).toBeUndefined()
  })
})
