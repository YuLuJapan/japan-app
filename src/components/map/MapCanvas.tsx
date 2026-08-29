// The map itself: full-bleed, and the one component that knows an engine exists.
//
// The engine arrives through a dynamic `import()` so Leaflet never reaches the
// entry chunk — with `show-map` off nothing here is ever fetched, which is
// lever 3 of the rollback plan. It is also why the import is *inside* the
// effect rather than at the top of the file.
//
// **What it does when it cannot draw** is as much of the job as what it does
// when it can (FR-026). Map imagery needs a network and is deliberately never
// precached (research R4), so with no connection this draws nothing and says
// so — to the page, which expands the sheet to full height and turns the card
// row into the vertical list the traveller can still use, with the explanation
// above it (research R11). Never a grey square, never a bare spinner, and the
// answer is a screenful of places rather than an apology in a corner.
import { useEffect, useRef, useState } from 'react'
import type { MapEngine, MapInset, MapView, SelfPosition } from '../../map/engine.types'
import type { Bounds, MapPin } from '../../map/pins'

export function MapCanvas({
  view,
  pins,
  bounds,
  inset,
  self,
  onPinTap,
  onReady,
  onUnavailable,
}: {
  view: MapView
  pins: MapPin[]
  bounds: Bounds | null
  /** What the top bar and the sheet cover, so framing aims at what is visible. */
  inset: MapInset
  self: SelfPosition | null
  onPinTap: (id: string) => void
  /** Handed the engine once it is mounted, so the page can pan it. */
  onReady?: (engine: MapEngine) => void
  /** True while the imagery cannot be drawn — the page expands the sheet. */
  onUnavailable: (unavailable: boolean) => void
}) {
  const host = useRef<HTMLDivElement | null>(null)
  const engine = useRef<MapEngine | null>(null)
  const [drawn, setDrawn] = useState(false)

  // The tap handler is replaced on every render (it closes over the page's
  // state); the engine is mounted once. A ref keeps the two independent, so
  // re-mounting a map is never the price of a new callback.
  const tap = useRef(onPinTap)
  tap.current = onPinTap

  useEffect(() => {
    let live = true
    // Offline is decided before the import rather than after it: the chunk may
    // well be in the service worker's precache while the *tiles* are not, so a
    // successful import says nothing about whether a map can be drawn.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      onUnavailable(true)
      return
    }
    import('../../map/engine.leaflet')
      .then(({ createEngine }) => {
        if (!live || !host.current) return
        const next = createEngine()
        next.mount(host.current, view)
        next.onPinTap((id) => tap.current(id))
        engine.current = next
        setDrawn(true)
        onUnavailable(false)
        onReady?.(next)
      })
      .catch(() => {
        // A chunk that will not load is the same story as no network, and the
        // traveller needs the same answer: the places, and why not the map.
        if (live) onUnavailable(true)
      })
    return () => {
      live = false
      engine.current?.destroy()
      engine.current = null
      setDrawn(false)
    }
    // Mount once. `view` is the *opening* view; every later move is `fitTo`.
  }, [])

  useEffect(() => {
    if (!drawn) return
    engine.current?.setPins(pins)
  }, [drawn, pins])

  // Before the fit below, and declared before it so it lands first on mount:
  // a frame computed against the wrong visible window is a frame the traveller
  // sees being corrected.
  useEffect(() => {
    if (!drawn) return
    engine.current?.setInset(inset)
  }, [drawn, inset])

  useEffect(() => {
    if (!drawn) return
    engine.current?.fitTo(bounds)
  }, [drawn, bounds, inset])

  useEffect(() => {
    if (!drawn) return
    engine.current?.setSelfMarker(self)
  }, [drawn, self])

  return (
    <div className="absolute inset-0 bg-line/60">
      <div ref={host} aria-label="Map" className="h-full w-full" />
    </div>
  )
}
