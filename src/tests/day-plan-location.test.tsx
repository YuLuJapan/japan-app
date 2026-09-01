// An optional location, typed straight into the day plan.
//
// The plan's inline form is the fast path — a title, maybe a time — so the
// location sits behind a disclosure and most lines never open it. What this
// file is really guarding is the *absence* rule: an edit that never touches the
// field must say nothing about the location, or editing a plan line's time
// would erase the pin the coordinate backfill found for it.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { DayPlan } from '../components/DayPlan'
import { TripRoleContext } from '../lib/session'
import { activity } from './helpers'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }))

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: mocks,
}))

const ICHIRAN = {
  name: 'Ichiran Shibuya',
  address: '1-22-7 Jinnan, Shibuya',
  lat: 35.66,
  lng: 139.7,
}

const TRIP_BUNDLE = {
  trip: {
    id: 'trip-1',
    name: 'Japan',
    country: 'Japan',
    display_title: 'Japan',
    start_date: '2027-03-01',
    end_date: '2027-03-08',
    description: null,
    people: [],
  },
  // The bias the search leans on comes from the bundle the day strip already
  // reads — the field costs no request of its own.
  steps: [
    {
      id: 's1',
      position: 0,
      start_date: '2027-03-01',
      end_date: '2027-03-04',
      zone: {
        id: 'zone-tokyo',
        name: 'Tokyo',
        name_ja: null,
        summary: null,
        lat: 35.68,
        lng: 139.76,
        saved_counts: { hotel: 0, attraction: 0, food: 0, shopping: 0, other: 0 },
      },
    },
  ],
  trip_files_count: 0,
  flight: null,
}

function renderPlan(items = [] as ReturnType<typeof activity>[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <TripRoleContext.Provider value="owner">
        <MemoryRouter initialEntries={['/trips/trip-1']}>
          <Routes>
            <Route
              path="/trips/:tripId"
              element={
                <DayPlan
                  day="2027-03-02"
                  sections={[{ zone: null, direction: null, items }]}
                  zoneId="zone-tokyo"
                  tripId="trip-1"
                />
              }
            />
          </Routes>
        </MemoryRouter>
      </TripRoleContext.Provider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.useRealTimers()
  for (const m of Object.values(mocks)) m.mockReset()
  // One mock, two endpoints: the geocoder and the trip bundle.
  mocks.get.mockImplementation((url: string) =>
    Promise.resolve(url.startsWith('/geocode') ? { results: [ICHIRAN] } : TRIP_BUNDLE)
  )
  mocks.post.mockResolvedValue({ activity: activity({ id: 'new-1', name: 'Lunch' }) })
  mocks.patch.mockImplementation((_u: string, body: unknown) =>
    Promise.resolve({
      activity: { ...activity({ id: 'itin-1', name: 'Lunch' }), ...(body as object) },
    })
  )
})

const openAddForm = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: '+ Add activity' }))
  await screen.findByLabelText('Activity')
}

describe('a location on a plan line', () => {
  it('is optional and out of the way until asked for', async () => {
    const user = userEvent.setup()
    renderPlan()
    await openAddForm(user)

    // The quick path is a title and a button; the field is one tap away.
    expect(screen.queryByLabelText('Location (optional)')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '+ Add a location' }))
    expect(screen.getByLabelText('Location (optional)')).toBeInTheDocument()
  })

  it('sends nothing about the location when the field was never opened', async () => {
    const user = userEvent.setup()
    renderPlan()
    await openAddForm(user)

    await user.type(screen.getByLabelText('Activity'), 'Nap')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(mocks.post).toHaveBeenCalled())
    const body = mocks.post.mock.calls[0][1]
    expect(body).toMatchObject({ name: 'Nap', day: '2027-03-02' })
    expect(body).not.toHaveProperty('lat')
    expect(body).not.toHaveProperty('lng')
    expect(body).not.toHaveProperty('address')
  })

  it('pins the activity when a suggestion is picked', async () => {
    const user = userEvent.setup()
    renderPlan()
    await openAddForm(user)

    await user.type(screen.getByLabelText('Activity'), 'Lunch')
    await user.click(screen.getByRole('button', { name: '+ Add a location' }))
    await user.type(screen.getByLabelText('Location (optional)'), 'Ichiran')

    await user.click(await screen.findByText('Ichiran Shibuya', {}, { timeout: 3000 }))
    expect(await screen.findByText(/Pinned to Ichiran Shibuya/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(mocks.post).toHaveBeenCalled())
    expect(mocks.post.mock.calls[0][1]).toMatchObject({
      name: 'Lunch',
      day: '2027-03-02',
      lat: 35.66,
      lng: 139.7,
      address: 'Ichiran Shibuya, 1-22-7 Jinnan, Shibuya',
    })
  })

  it('leans the search on the city the day is in', async () => {
    const user = userEvent.setup()
    renderPlan()
    await openAddForm(user)
    await user.click(screen.getByRole('button', { name: '+ Add a location' }))
    await user.type(screen.getByLabelText('Location (optional)'), 'Ichiran')

    await waitFor(
      () =>
        expect(
          mocks.get.mock.calls.some(
            (call: unknown[]) =>
              typeof call[0] === 'string' &&
              call[0].startsWith('/geocode') &&
              call[0].includes('lat=35.68') &&
              call[0].includes('lng=139.76')
          )
        ).toBe(true),
      { timeout: 3000 }
    )
  })
})

describe('editing a plan line that already has one', () => {
  const PINNED = activity({
    id: 'itin-1',
    name: 'Lunch',
    day: '2027-03-02',
    start_time: '12:30',
    zone_id: 'zone-tokyo',
    address: '1-22-7 Jinnan, Shibuya',
    lat: 35.66,
    lng: 139.7,
  })

  it('opens with the location showing, since there it is something to read', async () => {
    const user = userEvent.setup()
    renderPlan([PINNED])
    await user.click(screen.getByRole('button', { name: 'Edit' }))

    const field = await screen.findByLabelText('Location (optional)')
    expect(field).toHaveValue('1-22-7 Jinnan, Shibuya')
  })

  it('does NOT touch the pin when only the time is changed', async () => {
    const user = userEvent.setup()
    renderPlan([PINNED])
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await screen.findByLabelText('Location (optional)')

    await user.clear(screen.getByLabelText('Time'))
    await user.type(screen.getByLabelText('Time'), '13:00')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.patch).toHaveBeenCalled())
    const patch = mocks.patch.mock.calls[0][1]
    expect(patch).toMatchObject({ start_time: '13:00' })
    // The rule this file exists for: omitted leaves alone.
    expect(patch).not.toHaveProperty('lat')
    expect(patch).not.toHaveProperty('lng')
    expect(patch).not.toHaveProperty('address')
  })

  it('clears the coordinates when the text is changed without picking again', async () => {
    const user = userEvent.setup()
    renderPlan([PINNED])
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const field = await screen.findByLabelText('Location (optional)')

    await user.clear(field)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.patch).toHaveBeenCalled())
    // A coordinate describing a name that is no longer there is worse than
    // none — the rule LocationPicker already states for itself.
    expect(mocks.patch.mock.calls[0][1]).toMatchObject({ address: null, lat: null, lng: null })
  })
})
