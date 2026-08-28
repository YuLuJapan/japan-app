// Permission as data: every branch reachable, and none of them a throw.
//
// The distinction this file exists to protect is `denied` vs `unavailable`.
// The browser reports both through the same error callback, and collapsing
// them would have the map tell a traveller whose GPS timed out that they
// refused something — which is a lie they cannot act on.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { positionMessage, requestPosition, shouldAsk } from '../lib/geolocation'

/** A stub in the shape the browser hands over, with the codes it uses. */
const withGeolocation = (
  impl: (ok: PositionCallback, fail: PositionErrorCallback) => void | null
) => {
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (ok: PositionCallback, fail: PositionErrorCallback) => impl(ok, fail),
    },
  })
}

const error = (code: number) =>
  ({ code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }) as GeolocationPositionError

afterEach(() => vi.unstubAllGlobals())

describe('requestPosition', () => {
  it('answers granted with the coordinates and the accuracy', async () => {
    withGeolocation((ok) =>
      ok({ coords: { latitude: 35.66, longitude: 139.7, accuracy: 12 } } as GeolocationPosition)
    )
    await expect(requestPosition()).resolves.toEqual({
      status: 'granted',
      lat: 35.66,
      lng: 139.7,
      accuracy: 12,
    })
  })

  it('answers denied when the traveller — or a policy — refuses', async () => {
    withGeolocation((_ok, fail) => fail(error(1)))
    await expect(requestPosition()).resolves.toEqual({ status: 'denied' })
  })

  it('reads a timeout as unavailable, never as denied', async () => {
    // Nobody refused anything. Saying they did would be a lie the traveller
    // cannot correct, since there is no permission to un-refuse.
    withGeolocation((_ok, fail) => fail(error(3)))
    await expect(requestPosition()).resolves.toEqual({ status: 'unavailable' })
  })

  it('reads a position the device cannot determine as unavailable', async () => {
    withGeolocation((_ok, fail) => fail(error(2)))
    await expect(requestPosition()).resolves.toEqual({ status: 'unavailable' })
  })

  it('answers unavailable rather than throwing where there is no sensor at all', async () => {
    vi.stubGlobal('navigator', {})
    await expect(requestPosition()).resolves.toEqual({ status: 'unavailable' })
  })
})

describe('asking again', () => {
  it('does not re-ask after a refusal within the visit (FR-023)', () => {
    expect(shouldAsk({ status: 'denied' })).toBe(false)
    expect(shouldAsk({ status: 'unavailable' })).toBe(false)
  })

  it('does not ask twice at once', () => {
    expect(shouldAsk({ status: 'asking' })).toBe(false)
  })

  it('asks from idle, and re-asks once a position is already known', () => {
    expect(shouldAsk({ status: 'idle' })).toBe(true)
    expect(shouldAsk({ status: 'granted', lat: 1, lng: 2, accuracy: 3 })).toBe(true)
  })
})

describe('what the map says about it', () => {
  it('says different things about a refusal and a missing sensor', () => {
    expect(positionMessage({ status: 'denied' })).toMatch(/Location is off/)
    expect(positionMessage({ status: 'unavailable' })).toMatch(/unavailable/)
  })

  it('says nothing at all when there is nothing to say', () => {
    expect(positionMessage({ status: 'idle' })).toBe('')
    expect(positionMessage({ status: 'granted', lat: 1, lng: 2, accuracy: 3 })).toBe('')
  })
})
