// Naming the file, handing it over, and the four writers agreeing with each
// other.
//
// The writers are compared through `contentStrings`, which each of them
// exposes and each of them renders from. Three of the four formats are binary,
// so comparing the bytes would prove nothing; comparing what each writer was
// given to write is the honest version of "the same content" (FR-014).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { downloadFile, exportFileName, shareFile, toExportFile } from '../lib/export-file'
import { buildOutline, contentStrings, formatRange, NO_ADDRESS } from '../export/outline'
import { renderDocx } from '../export/docx'
import { renderXlsx } from '../export/xlsx'
import { renderJson, contentStrings as jsonStrings } from '../export/json'
import { fullPayload, sharePayload } from './export-fixture'

describe('the file name', () => {
  it('is built from the trip, says which version it is, and carries the extension', () => {
    expect(exportFileName('Yuval and Luciana in Japan', 'share', 'pdf')).toBe(
      'yuval-and-luciana-in-japan-share.pdf'
    )
    // The detail level is in the name because two files of the same trip must
    // not be indistinguishable in a Downloads folder — one of them has the
    // booking references in it.
    expect(exportFileName('Yuval and Luciana in Japan', 'full', 'pdf')).toBe(
      'yuval-and-luciana-in-japan-full.pdf'
    )
    expect(exportFileName('Test Trip', 'share', 'xlsx')).toBe('test-trip-share.xlsx')
  })

  it('strips anything that could break a header or escape a directory', () => {
    expect(exportFileName('../../etc/passwd', 'share', 'json')).toBe('etc-passwd-share.json')
    expect(exportFileName('Trip: "Kyoto" / Osaka', 'full', 'docx')).toBe(
      'trip-kyoto-osaka-full.docx'
    )
    expect(exportFileName('  ', 'share', 'pdf')).toBe('trip-share.pdf')
    expect(exportFileName('東京', 'share', 'pdf')).toBe('東京-share.pdf')
    expect(exportFileName('x'.repeat(200), 'share', 'pdf').length).toBeLessThanOrEqual(
      80 + '-share.pdf'.length
    )
  })
})

describe('handing the file over', () => {
  const file = () => toExportFile('bytes', 'Test Trip', 'share', 'pdf')
  let clicked: string[]

  beforeEach(() => {
    clicked = []
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => 'blob:stub',
      revokeObjectURL: () => {},
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicked.push(this.download)
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('falls back to a download when the browser cannot share files', async () => {
    // jsdom has no navigator.share at all — the desktop case, and the one the
    // fallback exists for.
    expect(await shareFile(file())).toBe('downloaded')
    expect(clicked).toEqual(['test-trip-share.pdf'])
  })

  it('falls back to a download when canShare refuses this file', async () => {
    Object.assign(navigator, { share: vi.fn(), canShare: () => false })
    expect(await shareFile(file())).toBe('downloaded')
    expect(clicked).toEqual(['test-trip-share.pdf'])
    delete (navigator as { share?: unknown }).share
    delete (navigator as { canShare?: unknown }).canShare
  })

  it('shares when the device can, and treats a dismissed sheet as neither', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { share, canShare: () => true })
    expect(await shareFile(file())).toBe('shared')
    expect(share).toHaveBeenCalledOnce()

    // Changing your mind is not a failure, and must not download a file you
    // did not ask to save.
    share.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'))
    expect(await shareFile(file())).toBe('cancelled')
    expect(clicked).toEqual([])

    // Anything else still leaves the traveller with a file.
    share.mockRejectedValueOnce(new Error('broken'))
    expect(await shareFile(file())).toBe('downloaded')
    expect(clicked).toEqual(['test-trip-share.pdf'])

    delete (navigator as { share?: unknown }).share
    delete (navigator as { canShare?: unknown }).canShare
  })

  it('saves under the name the export was given', () => {
    expect(downloadFile(file())).toBe('downloaded')
    expect(clicked).toEqual(['test-trip-share.pdf'])
  })
})

describe('the outline every readable writer renders', () => {
  it('lists a place with no address by name, and reports how many there are', () => {
    const outline = buildOutline(sharePayload())
    const hotel = outline.sections[0].places.find((p) => p.name === 'Test Hotel')
    // Not a blank row: the place is named, and the gap is marked (SC-008).
    expect(hotel).toEqual({ name: 'Test Hotel', address: NO_ADDRESS, type: 'Stay', details: [] })
    expect(outline.addressGapLine).toMatch(/1 place .* no address/)
  })

  it('keeps a stop with nothing in it, rather than dropping it', () => {
    const kyoto = buildOutline(sharePayload()).sections[1]
    expect(kyoto.title).toBe('Kyoto')
    expect(kyoto.places).toEqual([])
  })

  it('carries no prose at share detail and all of it at full', () => {
    expect(contentStrings(sharePayload()).join('\n')).not.toContain('Queue before noon')
    expect(contentStrings(fullPayload()).join('\n')).toContain('Queue before noon')
    expect(contentStrings(fullPayload()).join('\n')).toContain('Cash only')
    expect(contentStrings(sharePayload()).join('\n')).not.toContain('Cash only')
  })

  it('formats dates the same way wherever it is exported from', () => {
    expect(formatRange('2026-10-05', '2026-10-09')).toBe('5 Oct 2026 – 9 Oct 2026')
    expect(formatRange('2026-10-05', '2026-10-05')).toBe('5 Oct 2026')
  })
})

/** Unzip an OOXML file and return every text run in it, in order. */
async function textIn(blob: Blob, part: RegExp): Promise<string> {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  return Object.entries(files)
    .filter(([name]) => part.test(name))
    .map(([, bytes]) => strFromU8(bytes))
    .join('')
}

describe('the writers, against each other', () => {
  for (const detail of ['share', 'full'] as const) {
    it(`write the same content at ${detail} detail`, async () => {
      const payload = detail === 'share' ? sharePayload() : fullPayload()
      const expected = contentStrings(payload)

      const docx = await textIn(await renderDocx(payload), /word\/document\.xml/)
      const xlsx = await textIn(await renderXlsx(payload), /worksheets\/sheet/)
      const json = await (await renderJson(payload)).text()

      // The DOCX is the readable format that mirrors the outline most
      // closely, so it must carry every line of it — headings and dates
      // included.
      for (const value of expected) {
        if (!value.trim() || value === NO_ADDRESS) continue
        expect(docx, `docx is missing "${value}"`).toContain(value)
      }

      // The XLSX lays the places out as sortable rows rather than as a
      // document, and the JSON carries raw dates rather than printed ones —
      // so what is compared across all three is the trip *content*: every
      // place, its address, and every line of prose the level admits.
      for (const place of buildOutline(payload).sections.flatMap((s) => s.places)) {
        for (const readable of [docx, xlsx, json]) {
          expect(readable, `a writer is missing "${place.name}"`).toContain(place.name)
          if (place.address !== NO_ADDRESS) {
            expect(readable, `a writer is missing "${place.address}"`).toContain(place.address)
          }
          for (const line of place.details) {
            const head = line.split('\n')[0]
            // The JSON keeps a link as `{label, url}` rather than as a printed
            // line, so what is compared there is the value, not the wording.
            const wanted =
              readable === json && /^[^:]+: https?:/.test(head)
                ? head.slice(head.indexOf(': ') + 2)
                : head
            expect(readable, `a writer is missing "${wanted}"`).toContain(wanted)
          }
        }
      }
      // And nothing the level excludes reaches any of them.
      if (detail === 'share') {
        for (const writer of [docx, xlsx, json]) {
          expect(writer).not.toContain('Queue before noon')
          expect(writer).not.toContain('Cash only')
          expect(writer).not.toContain('Walk Shinjuku')
        }
      }
    })
  }

  it('produce files a word processor and a spreadsheet can open', async () => {
    const docx = unzipSync(new Uint8Array(await (await renderDocx(fullPayload())).arrayBuffer()))
    expect(Object.keys(docx).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/_rels/document.xml.rels',
      'word/document.xml',
      'word/styles.xml',
    ])
    const xlsx = unzipSync(new Uint8Array(await (await renderXlsx(fullPayload())).arrayBuffer()))
    expect(Object.keys(xlsx)).toEqual(
      expect.arrayContaining([
        '[Content_Types].xml',
        '_rels/.rels',
        'xl/workbook.xml',
        'xl/_rels/workbook.xml.rels',
        'xl/worksheets/sheet1.xml',
      ])
    )
    // Every part must be well-formed XML, or the file simply will not open.
    for (const [name, bytes] of Object.entries({ ...docx, ...xlsx })) {
      const doc = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml')
      expect(doc.querySelector('parsererror'), `${name} is not well-formed`).toBeNull()
    }
  })

  it('escapes trip content rather than letting it break the file', async () => {
    const payload = sharePayload()
    payload.steps[0].zone.places[0].name = 'Ramen & <Bar> "best"'
    const docx = await textIn(await renderDocx(payload), /word\/document\.xml/)
    expect(docx).toContain('Ramen &amp; &lt;Bar&gt;')
    expect(docx).not.toContain('<Bar>')
  })
})

describe('the JSON backup', () => {
  it('is the only writer that emits identifiers', async () => {
    const payload = sharePayload()
    const json = await (await renderJson(payload)).text()
    expect(json).toContain('"id": "place-ramen"')
    expect(json).toContain('"zone_id": "zone-tokyo"')

    const docx = await textIn(await renderDocx(payload), /word\/document\.xml/)
    const xlsx = await textIn(await renderXlsx(payload), /worksheets\/sheet/)
    for (const readable of [docx, xlsx]) {
      expect(readable).not.toContain('place-ramen')
      expect(readable).not.toContain('zone-tokyo')
    }
  })

  it('at share detail still carries exactly the share fields', async () => {
    // The machine-readable form is not a way around the projection (US4
    // acceptance 2): the payload it writes is the one the server projected.
    const json = JSON.parse(await (await renderJson(sharePayload())).text())
    const place = json.export.steps[0].zone.places[0]
    expect(Object.keys(place).sort()).toEqual(['address', 'category', 'id', 'name', 'zone_id'])
    expect(jsonStrings(sharePayload())).toContain('Ramen Bar')
  })
})
