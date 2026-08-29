// The port. Six methods, and not one of them knows what draws them.
//
// **No Leaflet type and no `leaflet` import may appear in this file** — that is
// the whole point of it (contracts/map.md §5). `engine.leaflet.ts` is the only
// module in the repository that imports the library; everything above this line
// programs against the interface, which buys three things at once:
//
//   - every test runs against `engine.fake.ts`, deterministically, with no
//     canvas and no network — jsdom has no layout, so a real map cannot mount
//     in one and a component that imported Leaflet directly would be untestable;
//   - swapping Leaflet for MapLibre later is one file;
//   - deleting the feature is `rm -r src/map` plus a route and a tab.
//
// It is the only structural pattern in this feature that is not already in the
// repo, and it is here because there is a real seam to defend.
import type { Bounds, MapPin } from './pins'

/** Where the map sits when it has nothing better to go on. */
export interface MapView {
  center: { lat: number; lng: number }
  zoom: number
}

/** A position to draw as "you", distinct from every place pin. */
export interface SelfPosition {
  lat: number
  lng: number
  /** Metres, when the device offers it — drawn as a halo, never as a number. */
  accuracy?: number
}

/**
 * How much of the map is covered by something else, in CSS pixels.
 *
 * The map is full-bleed: the top bar floats over it and the sheet covers the
 * bottom, so the container's centre is **not** the centre of what can be seen.
 * Told this, the engine frames and centres against the visible window instead
 * — otherwise `fitTo` tucks the southern pins under the sheet and `panTo`
 * puts the place it was asked to centre behind it.
 *
 * It is a property of the screen, not of a scale, which is why it is set once
 * rather than passed to every call.
 */
export interface MapInset {
  top: number
  bottom: number
}

export interface MapEngine {
  /** Attach to a container that already has a size. Called once. */
  mount(container: HTMLElement, view: MapView): void
  /** What is covering the map, so framing and centring aim at what is visible. */
  setInset(inset: MapInset): void
  /** Replace every pin. The engine owns the markers; the caller owns the list. */
  setPins(pins: MapPin[]): void
  /** Frame a box, or leave the view alone when there is nothing to frame. */
  fitTo(bounds: Bounds | null): void
  /** Show, move or clear the traveller's own position. */
  setSelfMarker(position: SelfPosition | null): void
  /** Move the view to a point without changing what is pinned. */
  panTo(point: { lat: number; lng: number }, zoom?: number): void
  /** Notify on a tap. One handler; the page is the only listener. */
  onPinTap(handler: (id: string) => void): void
  /** Release the DOM and the listeners. Called on unmount. */
  destroy(): void
}

/** What every implementation exports, so the dynamic import has a shape. */
export type CreateMapEngine = () => MapEngine
