// The printable version, on a trip three times the size of the real one.
//
// The seed data has 39 places across 9 zones, which fits comfortably and
// therefore proves nothing about pagination, a contents listing that runs past
// a handful of entries, or page numbers (SC-003, and the "long trip" edge case
// in the spec). This renders ~120 places across a dozen stops and reads the
// pages back.
import { describe, expect, it } from 'vitest'
import { buildPdf, renderPdf } from '../export/pdf'
import { fullPayload, longTripPayload, sharePayload } from './export-fixture'

/** Every string jsPDF wrote onto one page, in order. */
function textOnPage(doc: ReturnType<typeof buildPdf>, page: number): string {
  // jsPDF types `internal.pages` as numbers; each entry is really the array
  // of PDF content-stream fragments written onto that page.
  const streams = (doc.internal.pages[page] ?? []) as unknown as string[]
  return streams
    .join('\n')
    .split('\n')
    .flatMap((line) => line.match(/^\((.*)\) Tj$/)?.[1] ?? [])
    .join('\n')
}

const allText = (doc: ReturnType<typeof buildPdf>) =>
  Array.from({ length: doc.getNumberOfPages() }, (_, i) => textOnPage(doc, i + 1)).join('\n')

describe('a share PDF', () => {
  it('opens on a cover naming the trip and the version, and stamps every page', () => {
    const doc = buildPdf(sharePayload())
    const cover = textOnPage(doc, 1)
    expect(cover).toContain('Test Trip')
    // The file says which version it is, in its own words: the screen's
    // "Share with a friend" is an instruction to the sender, and the cover is
    // read by whoever receives it.
    expect(cover).toContain('Shared version')
    expect(cover).toContain('1 Oct 2026')
    // FR-018: the gap is on the page, not left to be noticed.
    expect(cover).toMatch(/1 place .* no address/)
    // The cover carries no page number; everything after it does.
    expect(cover).not.toMatch(/Page \d+ of \d+/)
    const total = doc.getNumberOfPages()
    expect(textOnPage(doc, total)).toContain(`Page ${total} of ${total}`)
  })

  it('carries nothing the traveller typed about a place', () => {
    const text = allText(buildPdf(fullPayload()))
    expect(text).toContain('Queue before noon')
    // …and the share version of the same trip does not.
    expect(allText(buildPdf(sharePayload()))).not.toContain('Queue before noon')
    expect(allText(buildPdf(sharePayload()))).not.toContain('Walk Shinjuku')
  })

  it('lists a place with no address by name rather than as a blank row', () => {
    expect(allText(buildPdf(sharePayload()))).toContain('Test Hotel')
  })

  it('produces a PDF file', async () => {
    const blob = await renderPdf(sharePayload())
    expect(blob.type).toBe('application/pdf')
    expect(blob.size).toBeGreaterThan(1000)
  })
})

describe('the day-by-day plan in a full PDF', () => {
  it('prints every day with the city it is spent in, empty ones included', () => {
    const text = allText(buildPdf(fullPayload()))
    expect(text).toContain('Day by day')
    expect(text).toContain('6 Oct 2026')
    expect(text).toContain('Tokyo')
    // The moving day: both cities, and an honest "nothing planned" rather than
    // a day quietly missing from the plan.
    expect(text).toContain('9 Oct 2026')
    expect(text).toContain('Tokyo to Kyoto')
    expect(text).toContain('Nothing planned.')
  })
})

describe('a long trip', () => {
  const payload = longTripPayload()

  it('paginates, and every stop is reachable from the contents listing', () => {
    const doc = buildPdf(payload)
    const total = doc.getNumberOfPages()
    // A cover, at least one contents page, and at least one page per stop.
    expect(total).toBeGreaterThanOrEqual(payload.steps.length + 2)

    const contents = textOnPage(doc, 2)
    for (const step of payload.steps) expect(contents).toContain(step.zone.name)

    // Every number in the listing is a page that exists, and none of them
    // points into the contents pages themselves.
    const numbers = contents
      .split('\n')
      .flatMap((line) => (/^\d+$/.test(line) ? [Number(line)] : []))
    expect(numbers).toHaveLength(payload.steps.length)
    for (const n of numbers) {
      expect(n).toBeGreaterThan(2)
      expect(n).toBeLessThanOrEqual(total)
    }
    // In journey order, and each stop's page really is that stop's page.
    expect([...numbers].sort((a, b) => a - b)).toEqual(numbers)
    payload.steps.forEach((step, i) => {
      expect(textOnPage(doc, numbers[i])).toContain(step.zone.name)
    })
  })

  it('numbers every page after the cover, consistently', () => {
    const doc = buildPdf(payload)
    const total = doc.getNumberOfPages()
    for (let page = 2; page <= total; page++) {
      expect(textOnPage(doc, page)).toContain(`Page ${page} of ${total}`)
    }
  })

  it('carries all 120 places, and renders in well under ten seconds', () => {
    const started = Date.now()
    const text = allText(buildPdf(payload))
    // SC-003 budgets ten seconds on a mid-range phone; this machine is not one,
    // so the bound is a smoke test against an accidental quadratic rather than
    // a measurement of the phone.
    expect(Date.now() - started).toBeLessThan(10_000)
    for (const step of payload.steps) {
      for (const place of step.zone.places) expect(text).toContain(place.name)
    }
  })
})
