// The word-processor version. Dynamically imported, like every writer.
//
// Renders `src/export/outline.ts` — the same outline the PDF renders — so a
// format cannot widen what is included (FR-014). The only difference between
// this file and pdf.ts is how a heading and a row are drawn.
import type { ExportPayload } from '../api/types'
import { buildDocx, type DocxParagraph } from './ooxml'
import { buildOutline } from './outline'

export { contentStrings } from './outline'

export async function renderDocx(payload: ExportPayload): Promise<Blob> {
  const o = buildOutline(payload)
  const full = payload.detail === 'full'
  const p: DocxParagraph[] = [
    { text: o.title, style: 'Title' },
    { text: `${o.dates}${o.country ? ` · ${o.country}` : ''}`, muted: true },
    { text: o.detailLabel, bold: true },
  ]
  if (o.description) p.push({ text: o.description })
  p.push({ text: o.statsLine, muted: true })
  if (o.addressGapLine) p.push({ text: o.addressGapLine, muted: true })
  p.push({ text: o.generated, muted: true })

  for (const section of o.sections) {
    p.push({ text: section.title, style: 'Heading1' })
    p.push({ text: section.dates, muted: true })
    if (full && section.summary) p.push({ text: section.summary })
    if (full) for (const tip of section.tips) p.push({ text: tip, bullet: true })
    if (!section.places.length) {
      p.push({ text: 'Nothing saved here yet.', muted: true })
      continue
    }
    for (const place of section.places) {
      p.push({ text: `${place.name} — ${place.type}`, style: 'Heading3' })
      p.push({ text: place.address, muted: true })
      // Full detail only: `details` is empty at share detail because the
      // outline had nothing to put in it, not because this skipped it.
      for (const detail of place.details) p.push({ text: detail })
    }
  }

  if (o.days.length) {
    p.push({ text: 'Day by day', style: 'Heading1' })
    for (const day of o.days) {
      p.push({ text: day.title, style: 'Heading3' })
      if (day.where) p.push({ text: day.where, muted: true })
      if (day.items.length) {
        for (const item of day.items) p.push({ text: item, bullet: true })
      } else {
        p.push({ text: 'Nothing planned.', muted: true })
      }
    }
  }

  return new Blob([buildDocx(p) as unknown as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}
