// Interactive city map (Leaflet + free CARTO Voyager tiles, no API key).
// One numbered pin per city in visit order; tap a pin to open that zone.
// A "Re-center" button appears once you pan/zoom away and restores the
// initial all-cities view.
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import { useNavigate } from 'react-router-dom'

export interface MapCity {
  id: string
  name: string
  lat: number
  lng: number
  order: number
  current: boolean
}

const FIT_OPTS: L.FitBoundsOptions = { padding: [36, 36], maxZoom: 9 }

function pinIcon(order: number, current: boolean) {
  const bg = current ? '#ff5a4d' : '#161a22'
  const ring = current ? 'box-shadow:0 0 0 4px rgba(255,90,77,.25);' : ''
  return L.divIcon({
    className: 'trip-pin',
    html: `<div style="transform:translate(-50%,-100%)">
      <div style="width:30px;height:30px;border-radius:50% 50% 50% 0;background:${bg};transform:rotate(-45deg);${ring}display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 3px 8px rgba(0,0,0,.3)">
        <span style="transform:rotate(45deg);color:#fff;font:700 12px/1 'Plus Jakarta Sans',sans-serif">${order}</span>
      </div>
    </div>`,
    iconSize: [30, 30],
    iconAnchor: [0, 0],
  })
}

// Owns the initial fit, exposes a recenter action, and flags when the user has
// moved the map away from that fit.
function MapController({
  cities,
  onMovedChange,
  bindRecenter,
}: {
  cities: MapCity[]
  onMovedChange: (moved: boolean) => void
  bindRecenter: (fn: () => void) => void
}) {
  const map = useMap()
  const key = cities.map((c) => `${c.lat},${c.lng}`).join('|')
  const bounds = useMemo(
    () =>
      cities.length ? L.latLngBounds(cities.map((c) => [c.lat, c.lng] as [number, number])) : null,
    [key]
  )
  // true while WE move the map (initial fit / recenter) so those moves don't
  // count as the user panning away.
  const settling = useRef(false)

  // Initial fit — repeated as the rounded/flex container settles its size.
  useEffect(() => {
    if (!bounds) return
    settling.current = true
    onMovedChange(false)
    const fit = () => {
      map.invalidateSize()
      map.fitBounds(bounds, { ...FIT_OPTS, animate: false })
    }
    fit()
    const t1 = setTimeout(fit, 200)
    const t2 = setTimeout(fit, 600)
    const done = setTimeout(() => {
      settling.current = false
    }, 800)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(done)
    }
  }, [map, bounds, onMovedChange])

  useEffect(() => {
    bindRecenter(() => {
      if (!bounds) return
      settling.current = true
      map.fitBounds(bounds, { ...FIT_OPTS, animate: true })
      onMovedChange(false)
      setTimeout(() => {
        settling.current = false
      }, 500)
    })
  }, [map, bounds, bindRecenter, onMovedChange])

  useMapEvents({
    moveend: () => {
      if (!settling.current) onMovedChange(true)
    },
    zoomend: () => {
      if (!settling.current) onMovedChange(true)
    },
  })

  return null
}

export function TripMap({ cities }: { cities: MapCity[] }) {
  const navigate = useNavigate()
  const [moved, setMoved] = useState(false)
  const recenterRef = useRef<(() => void) | null>(null)
  const bindRecenter = useCallback((fn: () => void) => {
    recenterRef.current = fn
  }, [])

  const center: [number, number] = cities.length ? [cities[0].lat, cities[0].lng] : [36.2, 138.0]

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={center}
        zoom={6}
        scrollWheelZoom={false}
        zoomControl={false}
        attributionControl={false}
        style={{ height: '100%', width: '100%', background: '#eaf1f4' }}
      >
        <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
        <MapController cities={cities} onMovedChange={setMoved} bindRecenter={bindRecenter} />
        {cities.map((c) => (
          <Marker
            key={c.id}
            position={[c.lat, c.lng]}
            icon={pinIcon(c.order, c.current)}
            eventHandlers={{ click: () => navigate(`/zones/${c.id}`) }}
          >
            <Popup>
              <button
                type="button"
                onClick={() => navigate(`/zones/${c.id}`)}
                style={{ font: "600 13px 'Plus Jakarta Sans',sans-serif", color: '#161a22' }}
              >
                {c.order}. {c.name} →
              </button>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {moved && (
        <button
          type="button"
          onClick={() => recenterRef.current?.()}
          className="absolute right-3 top-3 z-[1000] flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-2 text-xs font-bold text-ink shadow-card ring-1 ring-line backdrop-blur active:scale-95"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
          Re-center
        </button>
      )}
    </div>
  )
}
