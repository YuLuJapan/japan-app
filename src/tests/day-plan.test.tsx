// Moving an activity to another day from its own edit form (rather than
// deleting it and retyping it on the new day).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { DayPlan } from '../components/DayPlan'
import { RoleContext } from '../lib/session'
import type { ItineraryItem } from '../api/types'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }))

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: mocks,
}))

const TRIP_BUNDLE = {
  trip: {
    id: 'trip-1',
    name: 'Lisbon',
    country: 'Japan',
    display_title: 'Lisbon',
    start_date: '2027-03-01',
    end_date: '2027-03-08',
    description: null,
    people: [],
  },
  steps: [],
  trip_files_count: 0,
  flight: null,
}

const ITEM: ItineraryItem = {
  id: 'itin-1',
  trip_id: 'trip-1',
  zone_id: null,
  place_id: null,
  day: '2027-03-02',
  start_time: '09:00',
  title: 'Tram 28',
  note: null,
  position: 0,
  highlight: false,
  icon: null,
}

function renderPlan(items = [ITEM]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <RoleContext.Provider value="owner">
        {/* Mounted on a real /trips/:tripId route: the API hooks read the
            trip from the URL, exactly as they do in the app. */}
        <MemoryRouter initialEntries={['/trips/trip-1']}>
          <Routes>
            <Route
              path="/trips/:tripId"
              element={<DayPlan day="2027-03-02" items={items} tripId="trip-1" />}
            />
          </Routes>
        </MemoryRouter>
      </RoleContext.Provider>
    </QueryClientProvider>
  )
}

const openEditor = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Edit' }))
  await screen.findByLabelText('Day')
}

describe('DayPlan — moving an activity to another day', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.patch.mockReset()
    mocks.get.mockResolvedValue(TRIP_BUNDLE)
    mocks.patch.mockResolvedValue({ item: { ...ITEM, day: '2027-03-05' } })
  })

  it('offers the activity’s own day, bounded by the trip', async () => {
    const user = userEvent.setup()
    renderPlan()
    await openEditor(user)

    const field = screen.getByLabelText('Day')
    expect(field).toHaveValue('2027-03-02')
    expect(field).toHaveAttribute('min', '2027-03-01')
    expect(field).toHaveAttribute('max', '2027-03-08')
  })

  it('patches the day and says where it went', async () => {
    const user = userEvent.setup()
    renderPlan()
    await openEditor(user)

    await user.clear(screen.getByLabelText('Day'))
    await user.type(screen.getByLabelText('Day'), '2027-03-05')
    expect(screen.getByText(/Moves to .*Mar 5/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.patch).toHaveBeenCalled())
    expect(mocks.patch.mock.calls[0][0]).toBe('/trips/trip-1/itinerary/itin-1')
    expect(mocks.patch.mock.calls[0][1]).toMatchObject({ title: 'Tram 28', day: '2027-03-05' })
    // The activity has left this day — the list would otherwise just lose a row.
    expect(await screen.findByText(/Moved to .*Mar 5/)).toBeInTheDocument()
  })

  it('leaves the day out of the patch when it was not touched', async () => {
    const user = userEvent.setup()
    renderPlan()
    await openEditor(user)

    await user.clear(screen.getByLabelText('Activity'))
    await user.type(screen.getByLabelText('Activity'), 'Tram 28 to Graça')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.patch).toHaveBeenCalled())
    expect(mocks.patch.mock.calls[0][1].day).toBeUndefined()
    expect(screen.queryByText(/Moved to/)).not.toBeInTheDocument()
  })

  it('does not offer a day picker when adding — that is already this day', async () => {
    const user = userEvent.setup()
    renderPlan([])
    await user.click(screen.getByRole('button', { name: '+ Add activity' }))
    await screen.findByLabelText('Activity')
    expect(screen.queryByLabelText('Day')).not.toBeInTheDocument()
  })

  it('surfaces the API rule when the server rejects the day', async () => {
    const { ApiError } = await import('../api/client')
    mocks.patch.mockRejectedValue(
      new ApiError(400, 'VALIDATION', 'Invalid request', [
        "day must fall within the trip's dates (2027-03-01 – 2027-03-08)",
      ])
    )
    const user = userEvent.setup()
    renderPlan()
    await openEditor(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/day must fall within the trip's dates/)).toBeInTheDocument()
  })
})
