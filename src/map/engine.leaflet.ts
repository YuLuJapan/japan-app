// The only module in the repository that imports 'leaflet'.
//
// Everything else programs against `MapEngine` (engine.types.ts), which is what
// keeps the library one dynamic import away from the entry chunk and one file
// away from being replaced. Nothing here is exported but `createEngine`.
//
// The stylesheet is imported here too, for the same reason: bundled with the
// module that needs it, it arrives with the chunk instead of with the app.
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { CreateMapEngine, MapEngine, MapInset, MapView, SelfPosition } from './engine.types'
import type { Bounds, MapPin } from './pins'
import { categoryStyle, clusterSize } from './pins'
import { MAX_TILE_ZOOM, TILE_ATTRIBUTION, TILE_ATTRIBUTION_URL, TILE_URL } from './tiles'

/** Room around the outermost pins, so none of them sits on the screen edge. */
const FIT_MARGIN = 40

/** As far in as `fitTo` will go for a single pin — a street, not a doorway. */
const MAX_FIT_ZOOM = 16

/**
 * A pin as the render draws it: a solid category-coloured disc with a white
 * ring, a soft shadow, and the category's own glyph centred inside it — the
 * same glyph the legend and the card row show, so a traveller matches a pin
 * to its meaning without going back to the colour key.
 *
 * The fill and the glyph both come from `CATEGORY_META` through
 * `categoryStyle`, so the map is recoloured (or re-iconed) by the same edit
 * that changes the chips and the legend (research R12) — no map file names a
 * colour or a glyph of its own.
 */
const pinIcon = (pin: MapPin) => {
  const style = categoryStyle(pin.category)
  return L.divIcon({
    className: '', // Leaflet's own class paints a box we do not want
    html: `<span class="flex h-7 w-7 items-center justify-center rounded-full text-sm leading-none ring-2 ring-white shadow-pop ${style.dot}">${style.icon}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })
}

/**
 * A city at the trip scale, in 2c's vocabulary: a circle sized by how much is
 * saved there, carrying the count, with a name pill beneath it.
 *
 * This is the treatment carried forward from the reverted PR #93 — the part of
 * it that was right. What is *not* carried forward is its `projectStops`, which
 * mapped lat/lng onto a percentage field because that build had no tiles
 * underneath. Here Leaflet owns the projection, and a hand-rolled linear one
 * would fight it.
 */
const clusterIcon = (pin: MapPin) => {
  const size = clusterSize(pin.count ?? 0)
  return L.divIcon({
    className: '',
    html:
      `<span class="flex flex-col items-center" style="width:${size}px">` +
      `<span class="flex items-center justify-center rounded-full bg-ink font-display font-bold text-white shadow-pop" ` +
      `style="width:${size}px;height:${size}px">${pin.count ?? 0}</span>` +
      `<span class="mt-1 whitespace-nowrap rounded-full bg-white px-2 py-0.5 text-xs font-bold shadow-card">${escapeHtml(
        pin.name
      )}</span>` +
      `</span>`,
    // Anchored on the circle rather than the whole stack, so the pill hangs
    // below the point instead of shifting the city off it.
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

/** A city name reaches the DOM as markup here, and a trip is user-typed. */
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  )

/** "You", and never mistakable for a place. */
const selfIcon = () =>
  L.divIcon({
    className: '',
    html: '<span class="block h-3.5 w-3.5 rounded-full bg-ocean ring-4 ring-ocean/30"></span>',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  })

const toLatLngBounds = (b: Bounds) => L.latLngBounds([b.south, b.west], [b.north, b.east])

export const createEngine: CreateMapEngine = (): MapEngine => {
  let map: L.Map | null = null
  let layer: L.LayerGroup | null = null
  let self: L.Marker | null = null
  let halo: L.Circle | null = null
  let handler: (id: string) => void = () => undefined
  // What the top bar and the sheet are covering. Zero until the screen says
  // otherwise, which is exactly the old behaviour for a map nothing overlaps.
  let inset: MapInset = { top: 0, bottom: 0 }

  return {
    mount(container: HTMLElement, view: MapView) {
      map = L.map(container, {
        center: [view.center.lat, view.center.lng],
        zoom: view.zoom,
        // The app's own controls float over the map; Leaflet's would be a
        // second species of control in the same corner.
        zoomControl: false,
        attributionControl: false,
      })
      L.tileLayer(TILE_URL, { maxZoom: MAX_TILE_ZOOM }).addTo(map)
      // Attribution is a condition of using the imagery (FR-013), so it is
      // added by the same function that adds the tiles — not by a component
      // that could be rearranged without it.
      L.control
        .attribution({ prefix: false, position: 'bottomleft' })
        .addAttribution(`<a href="${TILE_ATTRIBUTION_URL}">${TILE_ATTRIBUTION}</a>`)
        .addTo(map)
      layer = L.layerGroup().addTo(map)
    },

    setInset(next: MapInset) {
      inset = next
    },

    setPins(pins: MapPin[]) {
      if (!map || !layer) return
      layer.clearLayers()
      for (const pin of pins) {
        // One shape, two vocabularies: a place is a category disc, a city is a
        // counted cluster. `count` is what the scale put there.
        L.marker([pin.lat, pin.lng], {
          icon: pin.count === undefined ? pinIcon(pin) : clusterIcon(pin),
          title: pin.name,
        })
          .on('click', () => handler(pin.id))
          .addTo(layer)
      }
    },

    fitTo(bounds: Bounds | null) {
      if (!map || !bounds) return
      // Asymmetric on purpose: the covered strips are added to the margin, so
      // the box lands in the gap between the top bar and the sheet rather than
      // in the middle of a container whose lower third cannot be seen.
      map.fitBounds(toLatLngBounds(bounds), {
        paddingTopLeft: [FIT_MARGIN, FIT_MARGIN + inset.top],
        paddingBottomRight: [FIT_MARGIN, FIT_MARGIN + inset.bottom],
        maxZoom: MAX_FIT_ZOOM,
      })
    },

    setSelfMarker(position: SelfPosition | null) {
      if (!map) return
      if (!position) {
        self?.remove()
        halo?.remove()
        self = null
        halo = null
        return
      }
      const at: L.LatLngExpression = [position.lat, position.lng]
      self = self ? self.setLatLng(at) : L.marker(at, { icon: selfIcon() }).addTo(map)
      if (position.accuracy) {
        halo = halo
          ? halo.setLatLng(at).setRadius(position.accuracy)
          : L.circle(at, { radius: position.accuracy, stroke: false, fillOpacity: 0.08 }).addTo(map)
      }
    },

    panTo(point: { lat: number; lng: number }, zoom?: number) {
      if (!map) return
      const at = zoom ?? map.getZoom()
      // `setView` puts the point at the *container's* centre, which on this
      // screen is behind the sheet. The visible window sits `(top - bottom) / 2`
      // above that, so the view centre is moved the same distance the other
      // way — south, in projected pixels — and the point lands in the middle
      // of the map the traveller can actually see.
      const lift = (inset.bottom - inset.top) / 2
      const centre = map.project([point.lat, point.lng], at).add([0, lift])
      map.setView(map.unproject(centre, at), at)
    },

    onPinTap(next: (id: string) => void) {
      handler = next
    },

    destroy() {
      map?.remove()
      map = null
      layer = null
      self = null
      halo = null
    },
  }
}
