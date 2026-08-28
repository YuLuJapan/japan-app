// The document, one step before it is a file.
//
// Every readable writer — PDF now, DOCX and XLSX later — renders *this*, not
// the payload. That is what FR-014 asks for in practice: the format cannot
// change what is included, because none of the writers reads the payload
// directly and so none of them can reach a field the outline did not carry.
// It also makes the three comparable to each other in a test, which is the
// only honest way to assert "the same content" across three binary formats
// (`contentStrings` below is what each writer exposes for that).
//
// Nothing here decides what may be exported: that was settled server-side in
// `server/src/lib/export-view.ts` before the payload was sent. This only
// decides the *shape on the page* — headings, order, what a row looks like.
import type { ExportPayload } from '../api/types'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-11-01` → `1 Nov 2026`. Deliberately not locale-dependent: the same
 *  trip exported on two phones must produce the same file (SC-006). */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  const month = MONTHS[Number(m) - 1]
  if (!month || !y) return iso
  return `${Number(d)} ${month} ${y}`
}

/** `1 Nov 2026 – 5 Nov 2026`, or a single date when they are the same. */
export const formatRange = (start: string, end: string): string =>
  start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`

const CATEGORY_LABEL: Record<string, string> = {
  hotel: 'Stay',
  attraction: 'See',
  food: 'Eat',
  shopping: 'Shop',
  other: 'Other',
}

/** What the recipient reads in the type column. */
export const categoryLabel = (category: string) => CATEGORY_LABEL[category] ?? category

/** Shown instead of an empty cell, so a place with no address is a listed
 *  place rather than a blank row (FR-018, SC-008). */
export const NO_ADDRESS = '—'

export interface OutlinePlace {
  name: string
  address: string
  type: string
  /** Full detail only: the description, the links, then the tips. */
  details: string[]
}

export interface OutlineSection {
  /** The zone. */
  title: string
  dates: string
  summary?: string
  tips: string[]
  places: OutlinePlace[]
}

export interface OutlineDay {
  title: string
  /** One line per activity, already in the server's order. */
  items: string[]
}

export interface Outline {
  title: string
  dates: string
  country: string
  /** "Shared version" / "Full copy" — printed, so the file says which it is. */
  detailLabel: string
  /** Full detail only. */
  description?: string
  generated: string
  /** "39 places · 12 stops", and the address gap when there is one. */
  statsLine: string
  addressGapLine?: string
  sections: OutlineSection[]
  days: OutlineDay[]
}

const DETAIL_LABEL = {
  share: 'Shared version',
  full: 'Full copy',
} as const

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function buildOutline(payload: ExportPayload): Outline {
  const full = payload.detail === 'full'

  const sections: OutlineSection[] = payload.steps.map((step) => ({
    title: step.zone.name,
    dates: formatRange(step.start_date, step.end_date),
    summary: step.zone.summary,
    tips: step.zone.tips ?? [],
    places: step.zone.places.map((place) => ({
      name: place.name,
      address: place.address || NO_ADDRESS,
      type: categoryLabel(place.category),
      details: [
        ...(place.description ? [place.description] : []),
        ...(place.links ?? []).map((l) => `${l.label}: ${l.url}`),
        ...(place.tips ?? []),
      ],
    })),
  }))

  const days: OutlineDay[] = payload.days.map((day) => ({
    title: formatDate(day.day),
    items: day.items.map((item) =>
      [
        item.start_time,
        item.icon,
        item.title,
        item.place_name && item.place_name !== item.title ? `(${item.place_name})` : undefined,
        item.note ? `— ${item.note}` : undefined,
      ]
        .filter(Boolean)
        .join(' ')
    ),
  }))

  const { place_count, places_without_address, day_count } = payload.stats
  const stats = [plural(place_count, 'place'), plural(payload.steps.length, 'stop')]
  if (full && day_count) stats.push(plural(day_count, 'day', 'days') + ' planned')

  return {
    title: payload.trip.title,
    dates: formatRange(payload.trip.start_date, payload.trip.end_date),
    country: payload.trip.country,
    detailLabel: DETAIL_LABEL[payload.detail],
    description: payload.trip.description,
    generated: `Exported ${formatDate(payload.generated_at.slice(0, 10))}`,
    statsLine: stats.join(' · '),
    // FR-018: reported rather than left to be noticed. Named places, not a
    // silent gap — the places themselves are still listed, by name.
    addressGapLine: places_without_address
      ? `${plural(places_without_address, 'place')} here ${
          places_without_address === 1 ? 'has' : 'have'
        } no address yet.`
      : undefined,
    sections,
    days,
  }
}

/**
 * Every string that reaches a readable file, flattened.
 *
 * This is what lets three binary formats be compared to each other: each
 * writer exposes it, each writer renders the same outline, so a writer that
 * quietly widened what it prints shows up as a difference here rather than as
 * a discovery in somebody's Downloads folder.
 */
export function contentStrings(payload: ExportPayload): string[] {
  const o = buildOutline(payload)
  const out = [o.title, o.dates, o.country, o.detailLabel, o.statsLine]
  if (o.description) out.push(o.description)
  if (o.addressGapLine) out.push(o.addressGapLine)
  for (const section of o.sections) {
    out.push(section.title, section.dates)
    if (section.summary) out.push(section.summary)
    out.push(...section.tips)
    for (const place of section.places) {
      out.push(place.name, place.address, place.type, ...place.details)
    }
  }
  for (const day of o.days) out.push(day.title, ...day.items)
  return out
}
