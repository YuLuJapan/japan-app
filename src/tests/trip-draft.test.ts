import { describe, expect, it } from 'vitest'
import { collectTripDraftErrors, tripErrorSummary } from '../lib/trip-draft'

const DATES = { startDate: '2027-03-01', endDate: '2027-03-08' }
const OK = { ...DATES, homeCurrencies: ['USD'] }

describe('collectTripDraftErrors', () => {
  it('lets a complete draft through', () => {
    expect(collectTripDraftErrors(OK)).toEqual({})
    expect(tripErrorSummary(collectTripDraftErrors(OK))).toBeNull()
  })

  // The whole point of the fix: these are all optional on the server
  // (collectTripErrors in server/src/services/trips.ts), so none of them may
  // block Save. The name in particular was doing exactly that behind a label
  // reading "Name it (optional)".
  it('asks for nothing but the dates and a currency', () => {
    // A draft with no name, no country, no travellers, no start time and no
    // flight is a valid trip.
    expect(collectTripDraftErrors(OK)).toEqual({})
  })

  it('reports every blocker at once rather than the first', () => {
    const errors = collectTripDraftErrors({ startDate: '', endDate: '', homeCurrencies: [] })
    expect(Object.keys(errors).sort()).toEqual(['currencies', 'end', 'start'])
    expect(tripErrorSummary(errors)).toMatch(/3 things/)
  })

  it('counts a half-picked date as missing, not as a contradiction', () => {
    const errors = collectTripDraftErrors({ ...OK, endDate: '' })
    expect(errors.end?.when).toBe('missing')
    expect(tripErrorSummary(errors)).toMatch(/one thing/i)
  })

  it('calls an end date before the start date a contradiction, shown right away', () => {
    const errors = collectTripDraftErrors({ ...OK, endDate: '2027-02-01' })
    expect(errors.end?.when).toBe('contradiction')
    expect(errors.end?.message).toMatch(/before the start date/i)
  })

  it('accepts a single-day trip — start and end on the same date', () => {
    expect(collectTripDraftErrors({ ...OK, endDate: OK.startDate })).toEqual({})
  })

  it('needs somewhere to convert money into', () => {
    const errors = collectTripDraftErrors({ ...DATES, homeCurrencies: [] })
    expect(errors.currencies?.when).toBe('missing')
  })
})
