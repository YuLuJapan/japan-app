// Which visits are the same city.
//
// A zone is one *visit* to a city (spec 011), so a trip that goes to Tokyo
// twice holds two zone rows. `city_key` is what still ties them together: the
// move-between-visits picker, the "2nd visit" label and the map's trip-scale
// chips all ask "which other zones are this city?".
//
// It is deliberately not the name. Matching on name is the find-or-create rule
// this spec removes, and it stops being true the moment someone renames one
// stay — "Tokyo — last days" is still Tokyo. So the key is derived **once**,
// when the zone is created, and never rewritten: a rename changes what a visit
// is called, not which city it is.
//
// Keep this in step with the backfill expression in
// supabase/migrations/0023_zone_city_key.sql. A zone created by the app and a
// zone backfilled by the migration have to agree, or two visits of one city
// quietly stop being siblings.

/**
 * The sibling key for a destination name: trimmed, internal whitespace
 * collapsed, lower-cased.
 *
 * Case and spacing are the differences that are never meaningful — a stop
 * typed "tokyo " and one typed "Tokyo" are the same city, and treating them
 * as two would put the traveller back where they started. Anything else is
 * left alone: "Kyoto" and "Kyōto" are different keys, because deciding they
 * are the same means transliterating, and a wrong guess silently merges two
 * cities that a traveller told the app were different.
 *
 * Returns null for a name with nothing in it, which reads as "no siblings" —
 * the same as a city visited once.
 */
export function cityKeyFor(name: string): string | null {
  const key = name.trim().replace(/\s+/g, ' ').toLowerCase()
  return key || null
}
