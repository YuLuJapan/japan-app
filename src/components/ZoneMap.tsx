// Per-city map (Leaflet + free tiles — see lib/tiles.ts — same stack as the
// all-cities TripMap). Plots the zone's saved places as category-coloured
// pins, lets you filter by category, and add new pins by searching OpenStreetMap
// (free, proxied through /api/geocode). Every saved place is listed below the
// map with a Pin it/Unpin toggle that attaches or clears its coordinates.
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect, useMemo, useState } from 'react'
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import { Link } from 'react-router-dom'
import { geocode } from '../api/hooks'
import { useCreatePlace, useSetPlaceCoords } from '../api/mutations'
import type { Category, GeocodeResult, PlaceListItem } from '../api/types'
import { CATEGORY_META } from '../api/types'
import { placeMapsUrl } from '../lib/maps'
import { tileLayer } from '../lib/tiles'

// Map filter set — the user's requested filters mapped onto the existing
// categories (coffee lives under Food). Order = chip order.
const MAP_CATS: { key: Category; label: string; color: string }[] = [
  { key: 'attraction', label: 'Must do', color: '#0284c7' },
  { key: 'food', label: 'Food', color: '#d97706' },
  { key: 'shopping', label: 'Shopping', color: '#db2777' },
  { key: 'hotel', label: 'Stays', color: '#7c3aed' },
  { key: 'other', label: 'More', color: '#059669' },
]
const CAT_COLOR = Object.fromEntries(MAP_CATS.map((c) => [c.key, c.color])) as Record<Category, string>
const CAT_LABEL = Object.fromEntries(MAP_CATS.map((c) => [c.key, c.label])) as Record<Category, string>

function pinIcon(category: Category, dimmed = false) {
  const color = CAT_COLOR[category] ?? '#059669'
  const emoji = CATEGORY_META[category]?.icon ?? '📍'
  return L.divIcon({
    className: 'zone-pin',
    html: `<div style="transform:translate(-50%,-100%);opacity:${dimmed ? 0.55 : 1}">
      <div style="width:32px;height:32px;border-radius:50% 50% 50% 0;background:${color};transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 3px 8px rgba(0,0,0,.3)">
        <span style="transform:rotate(45deg);font-size:15px;line-height:1">${emoji}</span>
      </div>
    </div>`,
    iconSize: [32, 32],
    iconAnchor: [0, 0],
  })
}

const pendingIcon = L.divIcon({
  className: 'zone-pin-pending',
  html: `<div style="transform:translate(-50%,-50%)">
    <div style="width:20px;height:20px;border-radius:50%;background:#ff5a4d;border:3px solid #fff;box-shadow:0 0 0 4px rgba(255,90,77,.3)"></div>
  </div>`,
  iconSize: [20, 20],
  iconAnchor: [0, 0],
})

// Frames the map to the given points. Refits only when the set of points
// changes (a pin added/located) — plain filter toggles don't move the map.
function FitController({ points }: { points: [number, number][] }) {
  const map = useMap()
  const key = points.map((p) => p.join(',')).join('|')
  useEffect(() => {
    if (!points.length) return
    const bounds = L.latLngBounds(points)
    const fit = () => {
      map.invalidateSize()
      if (points.length === 1) map.setView(points[0], 14, { animate: false })
      else map.fitBounds(bounds, { padding: [44, 44], maxZoom: 15, animate: false })
    }
    fit()
    const t1 = setTimeout(fit, 200)
    const t2 = setTimeout(fit, 550)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [map, key, points])
  return null
}

interface ZoneMapProps {
  zoneId: string
  zoneName: string
  center: [number, number]
  places: PlaceListItem[]
}

export function ZoneMap({ zoneId, zoneName, center, places }: ZoneMapProps) {
  const tiles = tileLayer()
  const mapped = useMemo(
    () => places.filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number'),
    [places]
  )

  // Which categories exist among the pins → which filter chips to show.
  const presentCats = useMemo(() => {
    const set = new Set<Category>()
    for (const p of mapped) set.add(p.category)
    return MAP_CATS.filter((c) => set.has(c.key))
  }, [mapped])

  // Active filters (all on by default). Kept in sync as categories appear.
  const [active, setActive] = useState<Set<Category>>(() => new Set(mapped.map((p) => p.category)))
  useEffect(() => {
    setActive((prev) => {
      const next = new Set(prev)
      for (const p of mapped) if (!next.has(p.category)) next.add(p.category)
      return next
    })
  }, [mapped])

  const shown = mapped.filter((p) => active.has(p.category))

  // Points the map frames: every mapped place + the city centre.
  const fitPoints = useMemo<[number, number][]>(
    () => [center, ...mapped.map((p) => [p.lat as number, p.lng as number] as [number, number])],
    [center, mapped]
  )

  const toggle = (c: Category) =>
    setActive((prev) => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })

  // ── Search-to-pin ─────────────────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeocodeResult[]>([])
  const [searching, setSearching] = useState(false)
  const [pending, setPending] = useState<GeocodeResult | null>(null)
  const create = useCreatePlace()
  const locate = useSetPlaceCoords(zoneId)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    let ignore = false
    setSearching(true)
    const t = setTimeout(() => {
      geocode(q, { lat: center[0], lng: center[1] })
        .then((r) => !ignore && setResults(r.results))
        .catch(() => !ignore && setResults([]))
        .finally(() => !ignore && setSearching(false))
    }, 450)
    return () => {
      ignore = true
      clearTimeout(t)
    }
  }, [query, center])

  // Locate an already-saved place onto the map. Nominatim often returns nothing
  // for a POI name glued to a full Japanese address, so try that first, then
  // fall back to the name alone (which resolves far more reliably).
  const [locateFailed, setLocateFailed] = useState<string | null>(null)
  const locatePlace = async (p: PlaceListItem) => {
    setLocateFailed(null)
    const bias = { lat: center[0], lng: center[1] }
    const queries = [
      [p.name, p.address ?? ''].filter(Boolean).join(', '),
      p.name,
    ].filter((q, i, a) => q && a.indexOf(q) === i)
    for (const q of queries) {
      try {
        const { results } = await geocode(q, bias)
        if (results[0]) {
          locate.mutate({ placeId: p.id, lat: results[0].lat, lng: results[0].lng })
          return
        }
      } catch {
        /* try the next query */
      }
    }
    setLocateFailed(p.id)
  }

  // Remove a place's pin from the map without deleting the place itself.
  const unpinPlace = (p: PlaceListItem) => {
    setLocateFailed(null)
    locate.mutate({ placeId: p.id, lat: null, lng: null })
  }

  const addPin = (category: Category) => {
    if (!pending) return
    create.mutate(
      {
        zone_id: zoneId,
        category,
        name: pending.name,
        address: pending.address,
        lat: pending.lat,
        lng: pending.lng,
      },
      {
        onSuccess: () => {
          setPending(null)
          setQuery('')
          setResults([])
        },
      }
    )
  }

  return (
    <div className="space-y-3">
      {/* filter chips */}
      {presentCats.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {presentCats.map((c) => {
            const on = active.has(c.key)
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => toggle(c.key)}
                aria-pressed={on}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ring-1 transition active:scale-95 ${
                  on ? 'text-white ring-transparent' : 'bg-white text-muted ring-line'
                }`}
                style={on ? { background: c.color } : undefined}
              >
                <span>{CATEGORY_META[c.key].icon}</span>
                {c.label}
              </button>
            )
          })}
        </div>
      )}

      {/* the map */}
      <div className="relative h-72 w-full overflow-hidden rounded-3xl shadow-card ring-1 ring-line">
        <MapContainer
          center={center}
          zoom={13}
          scrollWheelZoom={false}
          zoomControl={false}
          attributionControl={false}
          style={{ height: '100%', width: '100%', background: '#eaf1f4' }}
        >
          <TileLayer url={tiles.url} attribution={tiles.attribution} />
          <FitController points={fitPoints} />
          {shown.map((p) => (
            <Marker key={p.id} position={[p.lat as number, p.lng as number]} icon={pinIcon(p.category)}>
              <Popup>
                <div style={{ minWidth: 140 }}>
                  <p style={{ margin: 0, font: "700 13px 'Plus Jakarta Sans',sans-serif", color: '#161a22' }}>
                    {p.name}
                  </p>
                  <p style={{ margin: '2px 0 8px', font: "500 11px 'Plus Jakarta Sans',sans-serif", color: '#6b7280' }}>
                    {CAT_LABEL[p.category]}
                  </p>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <Link to={`/places/${p.id}`} style={{ font: "700 12px 'Plus Jakarta Sans',sans-serif", color: '#ff5a4d' }}>
                      Details →
                    </Link>
                    <a
                      href={placeMapsUrl(p.name, p.address)}
                      target="_blank"
                      rel="noreferrer"
                      style={{ font: "700 12px 'Plus Jakarta Sans',sans-serif", color: '#2563eb' }}
                    >
                      Directions
                    </a>
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
          {pending && <Marker position={[pending.lat, pending.lng]} icon={pendingIcon} />}
        </MapContainer>
      </div>

      {/* search-to-pin */}
      <div>
        <input
          className="field"
          placeholder={`Search a place to pin in ${zoneName}…`}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setPending(null)
          }}
        />

        {pending ? (
          <div className="mt-2 rounded-2xl border border-brand/20 bg-brand/5 p-3">
            <p className="text-sm font-bold">{pending.name}</p>
            {pending.address && <p className="mt-0.5 text-xs text-muted">{pending.address}</p>}
            <p className="mt-2 text-xs font-semibold text-muted">Pin as…</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {MAP_CATS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  disabled={create.isPending}
                  onClick={() => addPin(c.key)}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-white active:scale-95 disabled:opacity-60"
                  style={{ background: c.color }}
                >
                  <span>{CATEGORY_META[c.key].icon}</span>
                  {c.label}
                </button>
              ))}
              <button
                type="button"
                className="rounded-full px-3 py-1.5 text-xs font-bold text-muted ring-1 ring-line active:scale-95"
                onClick={() => setPending(null)}
              >
                Cancel
              </button>
            </div>
            {create.isError && (
              <p className="mt-2 text-xs text-brand">Couldn’t save — check your connection and retry.</p>
            )}
          </div>
        ) : (
          query.trim().length >= 2 && (
            <div className="mt-2 overflow-hidden rounded-2xl ring-1 ring-line">
              {searching && <p className="px-3 py-2 text-sm text-muted">Searching…</p>}
              {!searching && results.length === 0 && (
                <p className="px-3 py-2 text-sm text-muted">No matches — try a different name.</p>
              )}
              {results.map((r, i) => (
                <button
                  key={`${r.lat},${r.lng},${i}`}
                  type="button"
                  onClick={() => setPending(r)}
                  className="flex w-full flex-col items-start border-b border-line px-3 py-2 text-left last:border-0 hover:bg-line/40 active:bg-line/60"
                >
                  <span className="text-sm font-semibold">{r.name}</span>
                  {r.address && <span className="line-clamp-1 text-xs text-muted">{r.address}</span>}
                </button>
              ))}
            </div>
          )
        )}
      </div>

      {/* every saved place, with a pin/unpin toggle wired to the map above */}
      {places.length > 0 && (
        <div className="rounded-2xl bg-line/40 p-3">
          <p className="text-xs font-bold text-muted">Places in this zone ({places.length})</p>
          <ul className="mt-2 space-y-1.5">
            {places.map((p) => {
              const isPinned = typeof p.lat === 'number' && typeof p.lng === 'number'
              return (
                <li key={p.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm">
                    <span className="mr-1">{CATEGORY_META[p.category].icon}</span>
                    {p.name}
                    {locateFailed === p.id && (
                      <span className="ml-2 text-xs text-brand">couldn’t find it — search above</span>
                    )}
                  </span>
                  <button
                    type="button"
                    disabled={locate.isPending}
                    aria-pressed={isPinned}
                    onClick={() => (isPinned ? unpinPlace(p) : locatePlace(p))}
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ring-1 active:scale-95 disabled:opacity-60 ${
                      isPinned ? 'bg-white text-muted ring-line' : 'bg-white text-brand ring-line'
                    }`}
                  >
                    {isPinned ? 'Unpin' : 'Pin it'}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
