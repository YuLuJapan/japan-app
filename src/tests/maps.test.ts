import { describe, expect, it } from 'vitest'
import { coordMapsUrl, directionsUrl, placeMapsUrl } from '../lib/maps'

const query = (url: string) => decodeURIComponent(new URL(url).searchParams.get('query') ?? '')

describe('placeMapsUrl', () => {
  it('searches the name and address, with no country assumed', () => {
    expect(query(placeMapsUrl('Ramen Bar', 'Shinjuku'))).toBe('Ramen Bar, Shinjuku')
  })

  it('appends the city so the search lands in the right place', () => {
    expect(query(placeMapsUrl('Time Out Market', 'Av. 24 de Julho', 'Lisbon'))).toBe(
      'Time Out Market, Av. 24 de Julho, Lisbon'
    )
  })

  it('does not repeat a city the address already names', () => {
    expect(query(placeMapsUrl('Ramen Bar', 'Shinjuku, Tokyo', 'Tokyo'))).toBe(
      'Ramen Bar, Shinjuku, Tokyo'
    )
  })

  it('handles a missing address', () => {
    expect(query(placeMapsUrl('Don Quijote', null, 'Osaka'))).toBe('Don Quijote, Osaka')
  })
})

describe('coordMapsUrl', () => {
  it('links to a lat/lng point', () => {
    expect(coordMapsUrl(35.0116, 135.7681)).toContain('query=35.0116,135.7681')
  })
})

describe('directionsUrl', () => {
  it('uses coordinates when the place has them', () => {
    // The doorway, not a namesake: a lat/lng destination cannot match the wrong
    // "Ramen Bar" on the other side of the city.
    const url = directionsUrl('Ramen Bar', 'Shinjuku', 'Tokyo', { lat: 35.6614, lng: 139.7006 })
    expect(url).toBe('https://www.google.com/maps/dir/?api=1&destination=35.6614%2C139.7006')
  })

  it('falls back to the same text query the search link uses', () => {
    // A place the backfill could not resolve still gets directions — worse
    // aimed, but not a dead end.
    const url = directionsUrl('Ramen Bar', 'Shinjuku', 'Tokyo', null)
    expect(url).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=Ramen%20Bar%2C%20Shinjuku%2C%20Tokyo'
    )
  })

  it('treats half a location as no location', () => {
    const url = directionsUrl('Ramen Bar', null, 'Tokyo', { lat: 35.6614, lng: null })
    expect(url).toContain('destination=Ramen%20Bar%2C%20Tokyo')
  })

  it('does not repeat the city when the address already names it', () => {
    const url = directionsUrl('Nishiki Market', 'Nakagyo Ward, Kyoto', 'Kyoto')
    expect(decodeURIComponent(url)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=Nishiki Market, Nakagyo Ward, Kyoto'
    )
  })

  it('is a destination link, never a search (SC-008)', () => {
    expect(directionsUrl('X')).toContain('/maps/dir/')
    expect(directionsUrl('X')).not.toContain('/maps/search/')
  })
})
