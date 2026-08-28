// `resolvePlaceLocation` — one place in, one location or nothing out.
//
// The seam is `setGeocoder`, the same idiom as `setDataStore` and
// `setTokenVerifier`: the search itself is Nominatim's, and no test should
// ever reach it. What is worth asserting is the four decisions this wrapper
// makes on its own — which candidate wins, what "no candidate" returns, that
// the zone's coordinates are passed through as the bias, and that an
// unreachable upstream is a `null`, not a throw. The backfill runs across
// every place in a trip; one bad lookup must not end the run.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolvePlaceLocation, setGeocoder } from '../src/services/geocode.js'
import type { Geocoder, GeocodeResult } from '../src/services/geocode.js'

const tokyo: GeocodeResult = { name: 'Ichiran Shibuya', address: 'Jinnan', lat: 35.66, lng: 139.7 }
const other: GeocodeResult = { name: 'Ichiran Hakata', address: 'Fukuoka', lat: 33.59, lng: 130.4 }

afterEach(() => setGeocoder(null))

describe('resolvePlaceLocation', () => {
  it('returns the best candidate for a name and an address', async () => {
    setGeocoder(async () => [tokyo, other])
    expect(await resolvePlaceLocation({ name: 'Ichiran', address: '1-22-7 Jinnan' })).toEqual(tokyo)
  })

  it('searches on the name and the address together', async () => {
    const search: Geocoder = vi.fn(async () => [tokyo])
    setGeocoder(search)
    await resolvePlaceLocation({ name: 'Ichiran', address: '1-22-7 Jinnan' })
    expect(search).toHaveBeenCalledWith(expect.stringContaining('Ichiran'), undefined)
    expect(search).toHaveBeenCalledWith(expect.stringContaining('1-22-7 Jinnan'), undefined)
  })

  it('passes the zone coordinates through as the bias', async () => {
    const search: Geocoder = vi.fn(async () => [tokyo])
    setGeocoder(search)
    await resolvePlaceLocation({
      name: 'Ichiran',
      address: null,
      near: { lat: 35.68, lng: 139.76 },
    })
    expect(search).toHaveBeenCalledWith('Ichiran', { lat: 35.68, lng: 139.76 })
  })

  it('returns null when nothing matches', async () => {
    setGeocoder(async () => [])
    expect(await resolvePlaceLocation({ name: 'Nowhere at all', address: null })).toBeNull()
  })

  it('returns null rather than searching for a place with no name', async () => {
    const search: Geocoder = vi.fn(async () => [tokyo])
    setGeocoder(search)
    expect(await resolvePlaceLocation({ name: '   ', address: null })).toBeNull()
    expect(search).not.toHaveBeenCalled()
  })

  it('does not throw when the upstream is unreachable', async () => {
    setGeocoder(async () => {
      throw new Error('ENOTFOUND nominatim.openstreetmap.org')
    })
    await expect(
      resolvePlaceLocation({ name: 'Ichiran', address: '1-22-7 Jinnan' })
    ).resolves.toBeNull()
  })
})
