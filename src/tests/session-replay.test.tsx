// Session replay is the one thing in this app that can capture the screen, so
// the tests that matter are the refusals: which paths it will not run on, and
// that nothing runs at all with the flag off or analytics unconfigured.
//
// The masking config is asserted here too, next to the allowlist, because the
// two are one mechanism — the allowlist has leaky edges (a snapshot on start, a
// stop that lands an effect late) and masking is what makes those survivable.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { posthogOptions } from '../lib/posthog'
import {
  resetSessionReplayForTests,
  shouldRecord,
  syncSessionReplay,
  useSessionReplayScope,
} from '../lib/session-replay'

const state = vi.hoisted(() => ({ enabled: true, flag: false }))
const mocks = vi.hoisted(() => ({
  startSessionRecording: vi.fn(),
  stopSessionRecording: vi.fn(),
}))

vi.mock('../lib/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/posthog')>()),
  default: mocks,
  get analyticsEnabled() {
    return state.enabled
  },
}))

vi.mock('../lib/flags', () => ({ useBooleanFlag: () => state.flag }))

beforeEach(() => {
  state.enabled = true
  state.flag = false
  mocks.startSessionRecording.mockClear()
  mocks.stopSessionRecording.mockClear()
  resetSessionReplayForTests()
})

describe('the allowlist', () => {
  it('covers the create-trip flow and the static screens', () => {
    expect(shouldRecord('/trips')).toBe(true)
    expect(shouldRecord('/trips/')).toBe(true)
    expect(shouldRecord('/terms')).toBe(true)
    expect(shouldRecord('/privacy')).toBe(true)
    expect(shouldRecord('/trips/trip-1/essentials')).toBe(true)
  })

  // Every one of these renders trip content, and the first two carry a
  // credential in the path or the fragment, which no masking reaches.
  it.each([
    '/gate',
    '/invite/abc123',
    '/trips/trip-1',
    '/trips/trip-1/places/place-1',
    '/trips/trip-1/shopping',
    '/trips/trip-1/files',
    '/trips/trip-1/files/file-1',
    '/trips/trip-1/map',
    '/trips/trip-1/search',
    '/trips/trip-1/export',
    '/trips/trip-1/members',
    '/trips/trip-1/zones/zone-1',
  ])('refuses %s', (path) => {
    expect(shouldRecord(path)).toBe(false)
  })

  // A path nobody wrote down is refused, which is the direction this has to
  // fail in: a route added to the router tomorrow is not recorded by default.
  it('refuses a path it has never heard of', () => {
    expect(shouldRecord('/trips/trip-1/essentials/extra')).toBe(false)
    expect(shouldRecord('/whatever')).toBe(false)
  })
})

describe('syncSessionReplay', () => {
  it('records only where the flag and the path both agree', () => {
    syncSessionReplay(false, '/trips')
    expect(mocks.startSessionRecording).not.toHaveBeenCalled()

    syncSessionReplay(true, '/trips/trip-1')
    expect(mocks.startSessionRecording).not.toHaveBeenCalled()

    syncSessionReplay(true, '/trips')
    expect(mocks.startSessionRecording).toHaveBeenCalledTimes(1)
  })

  it('stops on the way out of a recorded screen', () => {
    syncSessionReplay(true, '/trips')
    syncSessionReplay(true, '/trips/trip-1')
    expect(mocks.stopSessionRecording).toHaveBeenCalledTimes(1)
  })

  // A restart is a fresh full-DOM snapshot, so moving between two recorded
  // screens must not touch the recorder at all.
  it('does not restart between two recorded screens', () => {
    syncSessionReplay(true, '/trips')
    syncSessionReplay(true, '/terms')
    syncSessionReplay(true, '/privacy')
    expect(mocks.startSessionRecording).toHaveBeenCalledTimes(1)
    expect(mocks.stopSessionRecording).not.toHaveBeenCalled()
  })

  // Turning the flag off mid-session is the rollback lever, and it has to reach
  // a recorder that is already running.
  it('stops when the flag goes off on a recorded screen', () => {
    syncSessionReplay(true, '/trips')
    syncSessionReplay(false, '/trips')
    expect(mocks.stopSessionRecording).toHaveBeenCalledTimes(1)
  })

  it('does nothing at all when analytics is unconfigured', () => {
    state.enabled = false
    syncSessionReplay(true, '/trips')
    expect(mocks.startSessionRecording).not.toHaveBeenCalled()
    expect(mocks.stopSessionRecording).not.toHaveBeenCalled()
  })
})

describe('useSessionReplayScope', () => {
  const render = (path: string) =>
    renderHook(() => useSessionReplayScope(), {
      wrapper: ({ children }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>,
    })

  it('stays off while the flag is off', () => {
    render('/trips')
    expect(mocks.startSessionRecording).not.toHaveBeenCalled()
  })

  it('starts on a recorded screen once the flag is on', () => {
    state.flag = true
    render('/trips')
    expect(mocks.startSessionRecording).toHaveBeenCalledTimes(1)
  })
})

describe('the masking that makes it safe', () => {
  // maskAllInputs alone would leave the booking reference, the shopping list
  // and every stay's description visible — they are text, not inputs.
  it('masks every text node, not just inputs', () => {
    expect(posthogOptions.session_recording?.maskAllInputs).toBe(true)
    expect(posthogOptions.session_recording?.maskTextSelector).toBe('*')
  })

  it('blocks the document viewer outright', () => {
    expect(posthogOptions.session_recording?.blockSelector).toBe('[data-replay-block]')
  })

  // Either of these would put whole API responses inside a replay.
  it('keeps network bodies out', () => {
    expect(posthogOptions.session_recording?.recordHeaders).toBe(false)
    expect(posthogOptions.session_recording?.recordBody).toBe(false)
  })

  // `defaults` is a dated bundle of config: '2026-06-25' and later turn on
  // session_recording.streamNetworkBody, which is the recordBody leak by
  // another name. Bumping the date is a decision, not a tidy-up.
  it('pins the defaults date below the one that streams network bodies', () => {
    expect(posthogOptions.defaults).toBe('2026-05-30')
  })

  it('leaves the recorder off until a screen asks for it', () => {
    expect(posthogOptions.disable_session_recording).toBe(true)
  })
})
