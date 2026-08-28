// The printable version. Dynamically imported, always — nothing in the entry
// bundle may reach this file.
//
// jsPDF + autotable rather than pdfmake, and the deciding number is *precache
// weight*, not download weight: this chunk is in the Workbox precache
// manifest, which is exactly what makes offline export work, so its size is
// paid at install time by every device. jsPDF with autotable is ~400 KB;
// pdfmake is ~1.4 MB, most of it a base64 Roboto it cannot avoid because it
// cannot use core fonts (research R2). Core Helvetica is enough here only
// because `name_ja` is out of scope this phase — the library choice and the
// CJK deferral are one decision seen twice.
//
// The contents listing and `Page n of m` need a number that is not known until
// the body has been laid out, hence the two passes: lay the body out recording
// which page each stop starts on, then insert the contents pages at the front
// and stamp the footers, shifting the recorded numbers by however many pages
// were inserted.
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { ExportPayload } from '../api/types'
import { buildOutline, type Outline, type OutlineSection } from './outline'

export { contentStrings } from './outline'

/**
 * `autoTable` records where it finished on the document it drew on, but the
 * functional entry point does not declare it. Where the table ended is the
 * only thing the surrounding layout needs from it, so it is declared here
 * rather than tracked in parallel.
 */
declare module 'jspdf' {
  interface jsPDF {
    lastAutoTable?: { finalY: number }
  }
}

const MARGIN = 48
const INK = '#1b1b1f'
const MUTED = '#6b6b76'
const LINE = '#d8d8de'

interface Cursor {
  doc: jsPDF
  y: number
  width: number
  height: number
}

const bottom = (c: Cursor) => c.height - MARGIN - 24 // room for the footer

function newPage(c: Cursor) {
  c.doc.addPage()
  c.y = MARGIN
}

/** Start a new page when `needed` points would not fit on this one. */
function ensure(c: Cursor, needed: number) {
  if (c.y + needed > bottom(c)) newPage(c)
}

function text(c: Cursor, value: string, opts: { size: number; bold?: boolean; color?: string }) {
  c.doc.setFont('helvetica', opts.bold ? 'bold' : 'normal')
  c.doc.setFontSize(opts.size)
  c.doc.setTextColor(opts.color ?? INK)
  const lines = c.doc.splitTextToSize(value, c.width) as string[]
  const lineHeight = opts.size * 1.35
  for (const line of lines) {
    ensure(c, lineHeight)
    c.doc.text(line, MARGIN, c.y + opts.size)
    c.y += lineHeight
  }
}

function cover(c: Cursor, outline: Outline) {
  c.y = MARGIN + 60
  text(c, outline.title, { size: 30, bold: true })
  c.y += 6
  text(c, outline.dates, { size: 13, color: MUTED })
  if (outline.country) text(c, outline.country, { size: 13, color: MUTED })
  c.y += 18
  text(c, outline.detailLabel, { size: 12, bold: true })
  if (outline.description) {
    c.y += 10
    text(c, outline.description, { size: 11 })
  }
  c.y += 18
  text(c, outline.statsLine, { size: 11, color: MUTED })
  if (outline.addressGapLine) text(c, outline.addressGapLine, { size: 11, color: MUTED })
  c.y += 6
  text(c, outline.generated, { size: 10, color: MUTED })
}

/** One stop: its heading, its zone notes, and its places as rows. */
function section(c: Cursor, s: OutlineSection, full: boolean) {
  // A heading with nothing under it at the foot of a page is the one layout
  // failure worth spending code on.
  ensure(c, 90)
  text(c, s.title, { size: 18, bold: true })
  text(c, s.dates, { size: 11, color: MUTED })
  if (full && s.summary) {
    c.y += 4
    text(c, s.summary, { size: 11 })
  }
  if (full && s.tips.length) {
    c.y += 4
    for (const tip of s.tips) text(c, `• ${tip}`, { size: 11 })
  }
  c.y += 10

  if (!s.places.length) {
    // An honest empty section rather than a missing one — and no word about
    // why it might be empty.
    text(c, 'Nothing saved here yet.', { size: 11, color: MUTED })
    c.y += 14
    return
  }

  const body: (string | { content: string; colSpan: number; styles: object })[][] = []
  for (const place of s.places) {
    body.push([place.name, place.address, place.type])
    // Full detail keeps one table and hangs the prose off the row it belongs
    // to, rather than a fourth column nobody can read on a phone-sized page.
    if (full && place.details.length) {
      body.push([
        {
          content: place.details.join('\n'),
          colSpan: 3,
          styles: {
            textColor: MUTED,
            fontSize: 9,
            cellPadding: { top: 0, bottom: 6, left: 8, right: 8 },
          },
        },
      ])
    }
  }

  autoTable(c.doc, {
    startY: c.y,
    margin: { left: MARGIN, right: MARGIN, bottom: MARGIN + 24 },
    head: [['Place', 'Address', 'Type']],
    body,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 10, textColor: INK, lineColor: LINE, cellPadding: 6 },
    headStyles: { fillColor: '#f2f2f5', textColor: MUTED, fontStyle: 'bold' },
    columnStyles: { 2: { cellWidth: 60 } },
  })
  c.y = (c.doc.lastAutoTable?.finalY ?? c.y) + 22
}

function dayPlan(c: Cursor, outline: Outline) {
  if (!outline.days.length) return
  ensure(c, 80)
  c.y += 6
  text(c, 'Day by day', { size: 18, bold: true })
  c.y += 8
  for (const day of outline.days) {
    ensure(c, 50)
    text(c, day.title, { size: 12, bold: true })
    for (const item of day.items) text(c, `• ${item}`, { size: 11 })
    c.y += 10
  }
}

/**
 * The contents listing, written onto pages that did not exist while the body
 * was being laid out. Each line links to the page its stop starts on, so
 * "every stop reachable from the contents listing" (SC-003) is a tap rather
 * than a scroll.
 */
function contents(
  doc: jsPDF,
  entries: { title: string; dates: string; page: number }[],
  firstPage: number,
  pageCount: number,
  width: number,
  height: number
) {
  let page = firstPage
  doc.setPage(page)
  let y = MARGIN
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(INK)
  doc.text('Contents', MARGIN, y + 18)
  y += 44

  for (const entry of entries) {
    if (y + 22 > height - MARGIN - 24) {
      page += 1
      if (page >= firstPage + pageCount) break // laid out for; cannot happen
      doc.setPage(page)
      y = MARGIN
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(INK)
    doc.text(entry.title, MARGIN, y + 11)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(MUTED)
    doc.text(entry.dates, MARGIN + 130, y + 11)
    const label = String(entry.page)
    doc.text(label, width - MARGIN - doc.getTextWidth(label), y + 11)
    doc.link(MARGIN, y, width - MARGIN * 2, 16, { pageNumber: entry.page })
    y += 22
  }
}

/** `Page n of m`, on everything but the cover. */
function footers(doc: jsPDF, width: number, height: number) {
  const total = doc.getNumberOfPages()
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(MUTED)
  for (let page = 2; page <= total; page++) {
    doc.setPage(page)
    const label = `Page ${page} of ${total}`
    doc.text(label, width - MARGIN - doc.getTextWidth(label), height - MARGIN + 8)
  }
}

/** How many pages the contents listing needs, before it is written. */
const contentsPageCount = (entries: number, height: number) => {
  const perPage = Math.max(1, Math.floor((height - MARGIN * 2 - 44 - 24) / 22))
  return Math.max(1, Math.ceil(entries / perPage))
}

/**
 * Render the payload to a PDF.
 *
 * Async only because the caller awaits it and because generating on the device
 * is what makes this work with no signal — nothing here touches the network.
 */
export async function renderPdf(payload: ExportPayload): Promise<Blob> {
  return buildPdf(payload).output('blob')
}

/**
 * The same document, before it is bytes.
 *
 * Exported so the pagination, contents-listing and page-number checks can be
 * asserted on a real 120-place trip (quickstart, SC-003) — a compressed blob
 * says nothing about how many pages it has or what is on them.
 */
export function buildPdf(payload: ExportPayload): jsPDF {
  const outline = buildOutline(payload)
  const full = payload.detail === 'full'
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()
  const c: Cursor = { doc, y: MARGIN, width: width - MARGIN * 2, height }

  doc.setProperties({ title: `${outline.title} — ${outline.detailLabel}` })

  // --- pass one: the cover and the body, recording where each stop starts ---
  cover(c, outline)
  const entries: { title: string; dates: string; page: number }[] = []
  for (const s of outline.sections) {
    newPage(c)
    entries.push({ title: s.title, dates: s.dates, page: doc.getCurrentPageInfo().pageNumber })
    section(c, s, full)
  }
  if (full && outline.days.length) {
    newPage(c)
    dayPlan(c, outline)
  }

  // --- pass two: the contents pages, and the numbers that only exist now ---
  const tocPages = contentsPageCount(entries.length, height)
  for (let i = 0; i < tocPages; i++) doc.insertPage(2 + i)
  for (const entry of entries) entry.page += tocPages
  contents(doc, entries, 2, tocPages, width, height)
  footers(doc, width, height)

  return doc
}
