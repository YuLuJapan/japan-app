import { describe, expect, it } from 'vitest'
import { travellersLabel } from '../lib/trip'

describe('travellersLabel', () => {
  it('falls back to "Our trip" with no travellers', () => {
    expect(travellersLabel([])).toBe('Our trip')
  })

  it('is just the name with one traveller', () => {
    expect(travellersLabel([{ name: 'Yuval' }])).toBe('Yuval')
  })

  it('joins two travellers with "&"', () => {
    expect(travellersLabel([{ name: 'Yuval' }, { name: 'Luciana' }])).toBe('Yuval & Luciana')
  })

  it('comma-separates three or more, with "&" before the last', () => {
    expect(
      travellersLabel([{ name: 'Yuval' }, { name: 'Luciana' }, { name: 'Noa' }])
    ).toBe('Yuval, Luciana & Noa')
    expect(
      travellersLabel([
        { name: 'Yuval' },
        { name: 'Luciana' },
        { name: 'Noa' },
        { name: 'Dan' },
      ])
    ).toBe('Yuval, Luciana, Noa & Dan')
  })
})
