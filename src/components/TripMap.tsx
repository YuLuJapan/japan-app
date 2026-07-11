// Interactive city map (Leaflet + free CARTO Voyager tiles, no API key).
// One numbered pin per city in visit order; tap a pin to open that zone.
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect } from 'react'
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import { useNavigate } from 'react-router-dom'

export interface MapCity {
  id: string
  name: string
  lat: number
  lng: number
  order: number
  current: boolean
}

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

function FitBounds({ cities }: { cities: MapCity[] }) {
  const map = useMap()
  useEffect(() => {
    if (cities.length === 0) return
    const bounds = L.latLngBounds(cities.map((c) => [c.lat, c.lng] as [number, number]))
    // Leaflet can initialize before the (flex/rounded) container has its final
    // size — invalidate + refit once now and again after layout settles so
    // tiles and pins land in the right place.
    const run = () => {
      map.invalidateSize()
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 9 })
    }
    run()
    const t1 = setTimeout(run, 200)
    const t2 = setTimeout(run, 600)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [map, cities])
  return null
}

export function TripMap({ cities }: { cities: MapCity[] }) {
  const navigate = useNavigate()
  const center: [number, number] = cities.length
    ? [cities[0].lat, cities[0].lng]
    : [36.2, 138.0]

  return (
    <MapContainer
      center={center}
      zoom={6}
      scrollWheelZoom={false}
      zoomControl={false}
      attributionControl={false}
      style={{ height: '100%', width: '100%', background: '#eaf1f4' }}
    >
      <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
      <FitBounds cities={cities} />
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
  )
}
