// The engine every test above the boundary runs against.
//
// It lives beside the port it implements rather than under `src/tests/`,
// because a port with only one implementation is an interface nobody has
// checked: the fake is what proves the six methods are enough, and it is the
// first thing that breaks if one of them grows a Leaflet-shaped assumption.
//
// jsdom has no layout, so a real map cannot mount in one. That is not a
// limitation being worked around here — it is the reason the port exists.
import type { CreateMapEngine, MapEngine, MapInset, MapView, SelfPosition } from './engine.types'
import type { Bounds, MapPin } from './pins'

/** Everything the fake saw, in the order it saw it. */
export interface FakeMapEngine extends MapEngine {
  mounted: boolean
  view: MapView | null
  pins: MapPin[]
  inset: MapInset | null
  fitted: Bounds | null
  self: SelfPosition | null
  pans: { lat: number; lng: number; zoom?: number }[]
  destroyed: boolean
  /** Drive a tap from a test, the way a finger would. */
  tap(id: string): void
}

export const createFakeEngine = (): FakeMapEngine => {
  let handler: (id: string) => void = () => undefined
  const engine: FakeMapEngine = {
    mounted: false,
    view: null,
    pins: [],
    inset: null,
    fitted: null,
    self: null,
    pans: [],
    destroyed: false,
    mount(_container, view) {
      engine.mounted = true
      engine.view = view
    },
    setPins(pins) {
      engine.pins = pins
    },
    setInset(inset) {
      engine.inset = inset
    },
    fitTo(bounds) {
      engine.fitted = bounds
    },
    setSelfMarker(position) {
      engine.self = position
    },
    panTo(point, zoom) {
      engine.pans.push({ ...point, zoom })
    },
    onPinTap(next) {
      handler = next
    },
    destroy() {
      engine.destroyed = true
      engine.mounted = false
    },
    tap(id) {
      handler(id)
    },
  }
  return engine
}

/**
 * The last fake a test mounted, so an assertion can reach it without the
 * component having to hand it back. One page mounts one map.
 */
let last: FakeMapEngine | null = null

export const lastFakeEngine = () => last

export const resetFakeEngine = () => {
  last = null
}

/** Matches `CreateMapEngine`, so it can stand in for the Leaflet module. */
export const createEngine: CreateMapEngine = () => {
  last = createFakeEngine()
  return last
}
