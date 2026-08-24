// Between the form's strings and the stored booking. These rules decide what a
// half-filled form is worth keeping, so they are worth pinning down without
// rendering anything.
import { describe, expect, it } from 'vitest'
import { describeDraft, emptyFlight, fromDraft, isDraftEmpty, toDraft } from '../lib/flight-draft'

const draftWith = (patch: Partial<ReturnType<typeof emptyFlight>> = {}) => ({
  ...emptyFlight(),
  ...patch,
})

describe('fromDraft', () => {
  it('keeps a flight number and its airports', () => {
    const draft = draftWith()
    draft.outbound.legs = [{ flight_no: 'ET 419', from: 'TLV', to: 'ADD' }]
    expect(fromDraft(draft)).toEqual({
      outbound: { legs: [{ flight_no: 'ET 419', from: 'TLV', to: 'ADD' }] },
    })
  })

  it('treats extra legs as the connection they are', () => {
    const draft = draftWith()
    draft.outbound.legs = [
      { flight_no: 'ET 419', from: 'TLV', to: 'ADD' },
      { flight_no: 'ET 672', from: 'ADD', to: 'NRT' },
    ]
    expect(fromDraft(draft)?.outbound?.legs).toHaveLength(2)
  })

  it('converts a typed time into the instant plus the zone it was typed in', () => {
    const draft = draftWith()
    draft.outbound.legs = [{ flight_no: 'ET 419', from: 'TLV', to: 'ADD' }]
    draft.outbound.departDate = '2026-09-18'
    draft.outbound.departTime = '15:35'
    draft.outbound.departTz = 'Asia/Jerusalem'
    expect(fromDraft(draft)?.outbound).toMatchObject({
      depart_at: '2026-09-18T12:35:00.000Z',
      depart_tz: 'Asia/Jerusalem',
    })
  })

  it('drops a direction with nothing typed into it', () => {
    const draft = draftWith()
    draft.outbound.legs = [{ flight_no: 'ET 419', from: 'TLV', to: 'ADD' }]
    expect(fromDraft(draft)?.return_flight).toBeUndefined()
  })

  it('ignores a time with no flight to attach it to', () => {
    // Otherwise the trip would count down to a departure that isn't a flight.
    const draft = draftWith()
    draft.outbound.departDate = '2026-09-18'
    draft.outbound.departTime = '15:35'
    expect(fromDraft(draft)).toBeNull()
  })

  it('is null when nothing at all was filled in', () => {
    expect(fromDraft(emptyFlight())).toBeNull()
    expect(isDraftEmpty(emptyFlight())).toBe(true)
  })

  it('trims, and keeps a leg that has only some of its fields', () => {
    const draft = draftWith()
    draft.outbound.legs = [{ flight_no: '  ET 419  ', from: '', to: '' }]
    expect(fromDraft(draft)?.outbound?.legs).toEqual([{ flight_no: 'ET 419', from: '', to: '' }])
  })
})

describe('toDraft', () => {
  it('round-trips a booking back out unchanged', () => {
    const flight = {
      airline: 'Ethiopian Airlines',
      booking_ref: 'ABC123',
      outbound: {
        depart_at: '2026-09-18T12:35:00.000Z',
        depart_tz: 'Asia/Jerusalem',
        arrive_at: '2026-09-19T10:40:00.000Z',
        arrive_tz: 'Asia/Tokyo',
        legs: [
          { flight_no: 'ET 419', from: 'TLV', to: 'ADD' },
          { flight_no: 'ET 672', from: 'ADD', to: 'NRT' },
        ],
      },
      return_flight: {
        legs: [{ flight_no: 'ET 673', from: 'NRT', to: 'ADD' }],
      },
    }
    expect(fromDraft(toDraft(flight))).toEqual(flight)
  })

  it('shows a stored time as the local time it was written in', () => {
    const draft = toDraft({
      outbound: {
        depart_at: '2026-09-18T12:35:00.000Z',
        depart_tz: 'Asia/Jerusalem',
        legs: [{ flight_no: 'ET 419', from: 'TLV', to: 'ADD' }],
      },
    })
    expect(draft.outbound.departDate).toBe('2026-09-18')
    expect(draft.outbound.departTime).toBe('15:35')
  })

  it('opens an empty form for a trip with no flight', () => {
    expect(isDraftEmpty(toDraft(null))).toBe(true)
    expect(isDraftEmpty(toDraft(undefined))).toBe(true)
  })
})

describe('describeDraft — the collapsed summary', () => {
  it('says nothing when nothing is filled in', () => {
    expect(describeDraft(emptyFlight())).toBeNull()
  })

  it('shows the route end to end, not every leg', () => {
    const draft = emptyFlight()
    draft.outbound.legs = [
      { flight_no: 'ET 419', from: 'TLV', to: 'ADD' },
      { flight_no: 'ET 672', from: 'ADD', to: 'NRT' },
    ]
    expect(describeDraft(draft)).toBe('TLV → NRT · 1 stop')
  })

  it('counts stops, plural', () => {
    const draft = emptyFlight()
    draft.outbound.legs = [
      { flight_no: 'A', from: 'TLV', to: 'ADD' },
      { flight_no: 'B', from: 'ADD', to: 'BKK' },
      { flight_no: 'C', from: 'BKK', to: 'NRT' },
    ]
    expect(describeDraft(draft)).toBe('TLV → NRT · 2 stops')
  })

  it('shows both directions when both are booked', () => {
    const draft = emptyFlight()
    draft.outbound.legs = [{ flight_no: 'ET 419', from: 'TLV', to: 'NRT' }]
    draft.return_flight.legs = [{ flight_no: 'ET 673', from: 'NRT', to: 'TLV' }]
    expect(describeDraft(draft)).toBe('TLV → NRT  ·  NRT → TLV')
  })

  it('falls back to the flight number when airports are blank', () => {
    const draft = emptyFlight()
    draft.outbound.legs = [{ flight_no: 'ET 419', from: '', to: '' }]
    expect(describeDraft(draft)).toBe('ET 419')
  })
})
