// The spreadsheet version: the places as rows that can be sorted and filtered,
// which is the one thing the other formats cannot offer.
//
// Two sheets, because a day plan is not a place and squeezing both into one
// table would make neither sortable. The day sheet exists only at full detail
// — at share detail the outline has no days, so there is nothing to write.
import type { ExportPayload } from '../api/types'
import { buildXlsx, type XlsxSheet } from './ooxml'
import { buildOutline } from './outline'

export { contentStrings } from './outline'

export async function renderXlsx(payload: ExportPayload): Promise<Blob> {
  const o = buildOutline(payload)
  const full = payload.detail === 'full'

  // Every place, flat, with its stop as a column — that is what makes the
  // sheet sortable at all. The nesting the readable formats use is the thing
  // a spreadsheet is worst at.
  const places: XlsxSheet = {
    name: 'Places',
    header: full
      ? ['Stop', 'Dates', 'Place', 'Address', 'Type', 'Notes']
      : ['Stop', 'Dates', 'Place', 'Address', 'Type'],
    widths: full ? [16, 26, 30, 42, 10, 60] : [16, 26, 30, 42, 10],
    rows: o.sections.flatMap((section) =>
      section.places.map((place) => {
        const row = [section.title, section.dates, place.name, place.address, place.type]
        return full ? [...row, place.details.join('\n')] : row
      })
    ),
  }

  const sheets: XlsxSheet[] = [places]
  if (o.days.length) {
    sheets.push({
      name: 'Day by day',
      header: ['Day', 'Where', 'What'],
      widths: [18, 24, 80],
      // A day with nothing planned still gets a row: sorting or filtering this
      // sheet must not be the thing that reveals a gap in the trip.
      rows: o.days.flatMap((day) =>
        day.items.length
          ? day.items.map((item) => [day.title, day.where, item])
          : [[day.title, day.where, '']]
      ),
    })
  }

  return new Blob([buildXlsx(sheets) as unknown as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}
