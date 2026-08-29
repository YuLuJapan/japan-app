// The visit wording, as a table. Pure — no rendering, no router, no store.
import { describe, expect, it } from 'vitest'
import { formatRange, visitLabel, visitTitle } from '../lib/visit-label'

const visit = (start: string | null, end: string | null, ordinal: number, total: number) => ({
  start_date: start,
  end_date: end,
  ordinal,
  total,
})

describe('visitLabel', () => {
  it('says nothing at all about a city visited once', () => {
    // The empty string is the common case and the point: it is what leaves
    // every single-visit city exactly as it was (FR-003). Callers render
    // nothing for '', rather than an empty element.
    expect(visitLabel(visit('2026-10-05', '2026-10-09', 1, 1))).toBe('')
  })

  it.each([
    [null, 'no visit block at all'],
    [undefined, 'a response that predates the field'],
  ])('says nothing for %s (%s)', (value, _why) => {
    expect(visitLabel(value)).toBe('')
  })

  it('labels a repeated city by its dates — what a traveller actually tells them apart by', () => {
    expect(visitLabel(visit('2026-10-05', '2026-10-09', 1, 2))).toBe('Oct 5–9')
    expect(visitLabel(visit('2026-10-12', '2026-10-14', 2, 2))).toBe('Oct 12–14')
  })

  it('falls back to an ordinal when a visit has no dates left', () => {
    // A stop removed from the journey keeps its content (FR-011), so its page
    // still opens — with nothing to date it by.
    expect(visitLabel(visit(null, null, 2, 2))).toBe('2nd visit')
    expect(visitLabel(visit(null, null, 1, 2))).toBe('1st visit')
    expect(visitLabel(visit(null, null, 3, 3))).toBe('3rd visit')
    expect(visitLabel(visit(null, null, 4, 4))).toBe('4th visit')
  })
})

describe('formatRange', () => {
  it.each([
    ['2026-09-19', '2026-09-25', 'Sep 19–25'],
    ['2026-09-28', '2026-10-03', 'Sep 28 – Oct 3'],
    ['2026-10-12', '2026-10-12', 'Oct 12'],
  ])('%s to %s → %j', (start, end, expected) => {
    expect(formatRange(start, end)).toBe(expected)
  })

  it('does not repeat the month when both dates share one', () => {
    // The label competes with the city's own name for room in a breadcrumb and
    // on a chip, and "Sep 19 – Sep 25" says nothing more than "Sep 19–25".
    expect(formatRange('2026-09-19', '2026-09-25')).not.toContain('Sep 25')
  })
})

describe('visitTitle', () => {
  it('leaves a city visited once completely alone', () => {
    expect(visitTitle('Kyoto', visit('2026-10-09', '2026-10-12', 1, 1))).toBe('Kyoto')
    expect(visitTitle('Kyoto', null)).toBe('Kyoto')
  })

  it('names the stay where the city alone would be ambiguous', () => {
    // A search result for "Tokyo hotel" returns two; each has to say which.
    expect(visitTitle('Tokyo', visit('2026-09-19', '2026-09-25', 1, 2))).toBe('Tokyo · Sep 19–25')
  })
})
