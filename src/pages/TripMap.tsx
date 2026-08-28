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
// R6) — the only `scope.kind` left in this file is the toggle that chooses a
// scale, and the analytics event that reports which one was chosen.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTrip, useZonePlaces } from '../api/hooks'
import { CATEGORIES, type Category } from '../api/types'
import { MapCanvas } from '../components/map/MapCanvas'
import { MapLegend } from '../components/map/MapLegend'
import { MapSheet } from '../components/map/MapSheet'
import { MapTopBar, type MapScale } from '../components/map/MapTopBar'
import { CategoryChips } from '../components/map/CategoryChips'
import { LocateButton } from '../components/map/LocateButton'
import { MissingPlaces } from '../components/map/MissingPlaces'
import { PlaceCardRow } from '../components/map/PlaceCardRow'
import { defaultZoneId, tripScope, zoneScope } from '../map/scope'
import { framedWith } from '../map/pins'
import type { MapEngine } from '../map/engine.types'
import { positionMessage, requestPosition, shouldAsk, type PositionState } from '../lib/geolocation'
import { capture } from '../lib/posthog'
import { useCanEdit } from '../lib/session'
import { useTripId } from '../lib/trip'

/**
 * Today, as the `YYYY-MM-DD` string every date in this app is stored as, in the
 * phone's own zone rather than UTC — a traveller in Tokyo at 8am is not still
 * on yesterday's step.
 */
const today = () => {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

export default function TripMap() {
  const tripId = useTripId()
  const canEdit = useCanEdit()
  const trip = useTrip(tripId)
  const steps = useMemo(() => trip.data?.steps ?? [], [trip.data])

  const [scale, setScale] = useState<MapScale>('zone')
  const [zoneId, setZoneId] = useState('')
  const [active, setActive] = useState<Set<Category> | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [offline, setOffline] = useState(false)
  const [position, setPosition] = useState<PositionState>({ status: 'idle' })
  const engine = useRef<MapEngine | null>(null)

  // Which city the map opens on: the current or next journey step's zone
  // (FR-008), decided by a pure function of the steps and today's date. The
  // trip bundle already carries every step's whole zone, coordinates included,
  // so both scales cost no request of their own (contracts §2).
  const opensOn = useMemo(() => defaultZoneId(steps, today()), [steps])
  useEffect(() => {
    if (!zoneId && opensOn) setZoneId(opensOn)
  }, [zoneId, opensOn])

  const zone = steps.map((s) => s.zone).find((z) => z?.id === (zoneId || opensOn)) ?? null
  const places = useZonePlaces(zoneId, '' as Category)
  const all = useMemo(() => places.data?.places ?? [], [places.data])

  // Only the categories actually present are offered (FR-010), in the app's own
  // order rather than the order the places happen to arrive in.
  const present = useMemo(() => CATEGORIES.filter((c) => all.some((p) => p.category === c)), [all])
  const shown = useMemo(
    () => (active === null ? all : all.filter((p) => active.has(p.category))),
    [all, active]
  )

  // The scope is memoised on the data, and `select` closes over it — so the
  // handler is reached through a ref rather than rebuilding every scope (and
  // with it every pin) whenever a selection changes.
  const selectRef = useRef<(id: string) => void>(() => undefined)
  const openZoneRef = useRef<(zoneId: string) => void>(() => undefined)

  // **The only place in this file that knows there are two scales.** Both
  // functions return one shape, so everything below renders identically and
  // never asks which one it has (research R6) — an `if (scope.kind === …)`
  // anywhere else would mean the strategy had leaked.
  const scope = useMemo(
    () =>
      scale === 'trip'
        ? tripScope({ steps, onPinTap: (id) => openZoneRef.current(id) })
        : zoneScope({
            zone: zone ?? { name: 'this trip', lat: null, lng: null },
            places: shown,
            onPinTap: (id) => selectRef.current(id),
          }),
    [scale, steps, zone, shown]
  )

  // Tapping a pin and tapping a card are the same event, so they are one
  // function: the card row scrolls to the selection and the pin's card expands,
  // and the two stay in step in both directions.
  const select = (id: string) => {
    setSelectedId(id)
    const card = scope.cards.find((c) => c.id === id)
    if (card?.place) capture('map_pin_opened', { category: card.place.category })
  }

  // Tapping a city at the trip scale drops into that city's places, which is
  // the second of the two taps every saved place stays behind (FR-009). No new
  // request: the zone response is already in the query cache for a city the
  // traveller has opened, and one fetch away for one they have not.
  const openZone = (nextZoneId: string) => {
    setZoneId(nextZoneId)
    setSelectedId(null)
    setScale('zone')
  }

  // The engine's own handlers read through refs, so a new selection never
  // rebuilds the scope — and never redraws every pin to expand one card.
  selectRef.current = select
  openZoneRef.current = openZone

  // Over the *shown* places, not over every place in the zone: the identity
  // that makes the number honest is `pins on screen + missing = what this
  // member can see in this view` (SC-004), and a filtered view is still a view.
  // The hidden-stay case takes care of itself — a withheld stay was never sent,
  // so it is in neither half. Both halves come from the scope, built from one
  // array in one pass, so they cannot drift.
  const missing = scope.missing.length
  // Narrowed to what the engine draws, rather than handing the state object
  // over: `status` is the page's business and a marker has no use for it.
  const self =
    position.status === 'granted'
      ? { lat: position.lat, lng: position.lng, accuracy: position.accuracy }
      : null

  // FR-025's rule is arithmetic and lives in `pins.ts`: a position near the
  // saved places widens the frame to include it, a distant one leaves the
  // frame alone. The button below is how the traveller goes to themselves
  // instead of dragging the places out of view.
  const bounds = useMemo(() => framedWith(scope.bounds, self), [scope.bounds, self])

  // **Only when asked for, never on mount** (FR-023). A refusal is not retried
  // within the visit either; a granted position is, because that is the button
  // being used for its second job — go to where I am now.
  const locate = useCallback(async () => {
    if (self) {
      engine.current?.panTo(self, 15)
      return
    }
    if (!shouldAsk(position)) return
    setPosition({ status: 'asking' })
    const next = await requestPosition()
    setPosition(next)
    if (next.status === 'granted') engine.current?.panTo(next, 15)
  }, [position, self])

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
        bounds={bounds}
        self={self}
        onPinTap={scope.onPinTap}
        onReady={(next) => {
          engine.current = next
        }}
        onUnavailable={setOffline}
      />
      <MapTopBar tripId={tripId} scale={scale} onScale={setScale} zoneName={zone?.name ?? null} />
      {!offline && <MapLegend categories={present} />}
      {!offline && <LocateButton state={position} onLocate={locate} />}
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
        <MissingPlaces places={scope.missing} tripId={tripId} canEdit={canEdit} />
        {/* A refusal is a line, not an error screen: the map is fully usable
            without a position and saying otherwise would be theatre (FR-024). */}
        {positionMessage(position) && (
          <p className="px-4 pt-2 text-sm text-muted">{positionMessage(position)}</p>
        )}
        <div className="mt-3">
          <PlaceCardRow
            cards={scope.cards}
            selectedId={selectedId}
            onSelect={select}
            tripId={tripId}
            zoneName={zone?.name ?? null}
          />
        </div>
      </MapSheet>
    </div>
  )
}
