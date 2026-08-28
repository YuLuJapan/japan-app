// The map screen. Orchestration only.
//
// It holds the scale, the active filters and the selected place, wires the
// callbacks, and chooses which of 2a's elements to render. **It does no
// geometry and no filtering of its own**: a `.filter(` or a `Math.min(`
// appearing here belongs in `src/map/pins.ts` or `src/map/scope.ts`, which are
// pure and unit-tested with no React in them (plan → Small methods).
//
// It also never asks which scale it is on. `zoneScope` and `tripScope` return
// one shape, so the page renders the same six elements either way (research
// R6) — the only `scope.kind` in this file is the toggle itself.
import { useEffect, useMemo, useState } from 'react'
import { useTrip, useZonePlaces } from '../api/hooks'
import { CATEGORIES, type Category } from '../api/types'
import { MapCanvas } from '../components/map/MapCanvas'
import { MapLegend } from '../components/map/MapLegend'
import { MapSheet } from '../components/map/MapSheet'
import { MapTopBar, type MapScale } from '../components/map/MapTopBar'
import { CategoryChips } from '../components/map/CategoryChips'
import { PlaceCardRow } from '../components/map/PlaceCardRow'
import { zoneScope } from '../map/scope'
import { missingCount } from '../map/pins'
import { capture } from '../lib/posthog'
import { useTripId } from '../lib/trip'

export default function TripMap() {
  const tripId = useTripId()
  const trip = useTrip(tripId)
  const steps = useMemo(() => trip.data?.steps ?? [], [trip.data])

  const [scale, setScale] = useState<MapScale>('zone')
  const [zoneId, setZoneId] = useState('')
  const [active, setActive] = useState<Set<Category> | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [offline, setOffline] = useState(false)

  // Which city the map opens on. The trip bundle already carries every step's
  // whole zone, coordinates included, so this costs no request (contracts §2).
  const openOn = steps.find((s) => s.zone)?.zone ?? null
  useEffect(() => {
    if (!zoneId && openOn) setZoneId(openOn.id)
  }, [zoneId, openOn])

  const zone = steps.map((s) => s.zone).find((z) => z?.id === zoneId) ?? openOn
  const places = useZonePlaces(zoneId, '' as Category)
  const all = useMemo(() => places.data?.places ?? [], [places.data])

  // Only the categories actually present are offered (FR-010), in the app's own
  // order rather than the order the places happen to arrive in.
  const present = useMemo(() => CATEGORIES.filter((c) => all.some((p) => p.category === c)), [all])
  const shown = useMemo(
    () => (active === null ? all : all.filter((p) => active.has(p.category))),
    [all, active]
  )

  const scope = useMemo(
    () =>
      zoneScope({
        zone: zone ?? { name: 'this trip', lat: null, lng: null },
        places: shown,
        onPinTap: setSelectedId,
      }),
    [zone, shown]
  )

  const missing = missingCount(shown)

  // One event per opening and per change of scale. Two enums and two counts —
  // never a name, an address or a coordinate (research R9).
  useEffect(() => {
    if (!places.data) return
    capture('map_opened', {
      scope: scope.kind,
      pin_count: scope.pins.length,
      missing_coords: missing,
    })
    // Deliberately not re-sent on every filter toggle: the question is how the
    // map is opened, not how it is fiddled with.
  }, [places.data, scope.kind])

  const toggle = (category: Category) => {
    setActive((current) => {
      const next = new Set(current ?? present)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      // Every category on is the `All` state, not a full selection — otherwise
      // the `All` chip would go dark while nothing was filtered.
      return next.size === present.length ? null : next
    })
  }

  return (
    <div className="absolute inset-0 overflow-hidden">
      <MapCanvas
        view={scope.view}
        pins={scope.pins}
        bounds={scope.bounds}
        self={null}
        onPinTap={scope.onPinTap}
        onUnavailable={setOffline}
      />
      <MapTopBar tripId={tripId} scale={scale} onScale={setScale} zoneName={zone?.name ?? null} />
      {!offline && <MapLegend categories={present} />}
      <MapSheet
        expanded={offline || expanded}
        onToggle={offline ? null : () => setExpanded((e) => !e)}
      >
        {offline && (
          // The one state where the map cannot be the answer, so the list is
          // (FR-026). Said plainly and above the places, not as an error.
          <p className="px-4 pb-3 text-sm text-muted">
            The map needs a connection — map imagery is never stored on your phone. Everything you
            saved here is below.
          </p>
        )}
        <CategoryChips
          present={present}
          active={active}
          onToggle={toggle}
          onAll={() => setActive(null)}
        />
        {scope.pins.length === 0 && (
          <p className="px-4 py-3 text-sm text-muted">{scope.emptyMessage}</p>
        )}
        <div className="mt-3">
          <PlaceCardRow cards={scope.cards} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
      </MapSheet>
    </div>
  )
}
