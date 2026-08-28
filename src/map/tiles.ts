// The tiles, and the words their terms require, in one module.
//
// FR-013 makes the attribution a *condition of using the imagery at all*, not a
// nicety — so it lives beside the URL it belongs to rather than in whichever
// component happened to need it first. A string duplicated across two
// components is a string that gets deleted from the wrong one.
//
// Free OSM raster tiles: no key, no account, no billing — which is what the
// project's $0 constraint requires (research R3).
//
// **These tiles are never precached** (FR-014, research R4). The provider's
// policy forbids bulk downloading, and a Workbox precache is bulk downloading
// by definition; independently, every precached byte is a byte every phone
// downloads at install. So `src/map/` stays out of the precache manifest, and
// with no network the screen says so rather than drawing a grey square.

/** Standard OSM raster tiles. `{s}` is the subdomain, `{z}/{x}/{y}` the tile. */
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

/** Required by the tile provider's terms, and rendered on the map itself. */
export const TILE_ATTRIBUTION = '© OpenStreetMap contributors'

/** Where that attribution points, for the half of the audience that follows it. */
export const TILE_ATTRIBUTION_URL = 'https://www.openstreetmap.org/copyright'

/** As far in as the provider serves. Beyond it Leaflet would ask for nothing. */
export const MAX_TILE_ZOOM = 19
