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
  const parts = [name, address ?? ''].map((s) => s.trim()).filter(Boolean)
  let query = parts.join(', ')
  const city = (context ?? '').trim()
  if (city && !new RegExp(`\\b${escapeRe(city)}\\b`, 'i').test(query)) query += `, ${city}`
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Link to a lat/lng point (used for zones, which have coordinates).
export function coordMapsUrl(lat: number, lng: number, label?: string): string {
  const q = label ? `${encodeURIComponent(label)}@${lat},${lng}` : `${lat},${lng}`
  return `https://www.google.com/maps/search/?api=1&query=${q}`
}
