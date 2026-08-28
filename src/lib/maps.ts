// Build a Google Maps link for a place. On phones this opens the Google Maps
// app straight to a search for the place, from which "Directions" is one tap.
// Most places store a name + optional address (no coordinates), so we search by
// text; `context` (the city the place sits in) is appended when it isn't
// already in the query, which is what keeps "Ramen Bar" from matching a
// namesake on the other side of the world. Trips are not Japan-only, so
// nothing is assumed about the country.
export function placeMapsUrl(
  name: string,
  address?: string | null,
  context?: string | null
): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    textQuery(name, address, context)
  )}`
}

/** The name, its address and its city — shared so the two links never disagree. */
function textQuery(name: string, address?: string | null, context?: string | null): string {
  const parts = [name, address ?? ''].map((s) => s.trim()).filter(Boolean)
  let query = parts.join(', ')
  const city = (context ?? '').trim()
  if (city && !new RegExp(`\\b${escapeRe(city)}\\b`, 'i').test(query)) query += `, ${city}`
  return query
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Link to a lat/lng point (used for zones, which have coordinates).
export function coordMapsUrl(lat: number, lng: number, label?: string): string {
  const q = label ? `${encodeURIComponent(label)}@${lat},${lng}` : `${lat},${lng}`
  return `https://www.google.com/maps/search/?api=1&query=${q}`
}

/**
 * Directions *to* a place, rather than a search for it.
 *
 * `placeMapsUrl` above builds a search link, from which Directions is one more
 * tap — fine on a place detail page, one tap short of what FR-011 asks for from
 * a pin, where the budget is two (SC-008). This is Google's documented
 * `dir` deep link: free, no key, and it opens the installed app on both
 * platforms, so no platform sniffing is needed.
 *
 * Coordinates when the place has them — they name the doorway rather than a
 * namesake — and the same text query as the search link when it does not, so a
 * place the backfill could not resolve still gets directions.
 */
export function directionsUrl(
  name: string,
  address?: string | null,
  context?: string | null,
  coords?: { lat?: number | null; lng?: number | null } | null
): string {
  const destination =
    typeof coords?.lat === 'number' && typeof coords?.lng === 'number'
      ? `${coords.lat},${coords.lng}`
      : textQuery(name, address, context)
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`
}
