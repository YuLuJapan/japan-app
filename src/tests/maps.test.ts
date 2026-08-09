import { describe, expect, it } from 'vitest'
import { coordMapsUrl, placeMapsUrl } from '../lib/maps'

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
