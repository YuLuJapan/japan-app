// Moving an activity to another day from its own edit form (rather than
// deleting it and retyping it on the new day).
//
// The activity is a real row and the patches really land, so the last case —
// the server refusing a day outside the trip — is the API's own rule reaching
// the screen rather than an error message a stub was handed.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { DayPlan } from '../components/DayPlan'
import { TripRoleContext } from '../lib/session'
import type { ItineraryItem } from '../api/types'
import { insert, patchTrip, remove, rows } from './data'

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

beforeEach(async () => {
  // A trip whose dates bound the day picker, holding one activity.
  await patchTrip('trip-1', {
    name: 'Lisbon',
    start_date: '2027-03-01',
    end_date: '2027-03-08',
  })
  await remove('journey_steps', 'trip_id', 'trip-1')
  await remove('itinerary_items', 'trip_id', 'trip-1')
  await insert('itinerary_items', [{ ...ITEM }])
})

function renderPlan(items = [ITEM]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <TripRoleContext.Provider value="owner">
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
      </TripRoleContext.Provider>
    </QueryClientProvider>
  )
}

const openEditor = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Edit' }))
  await screen.findByLabelText('Day')
}

describe('DayPlan — moving an activity to another day', () => {
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

    await waitFor(async () => {
      const [saved] = await rows<ItineraryItem>('itinerary_items', 'id', 'itin-1')
      expect(saved).toMatchObject({ title: 'Tram 28', day: '2027-03-05' })
    })
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

    await waitFor(async () => {
      const [saved] = await rows<ItineraryItem>('itinerary_items', 'id', 'itin-1')
      expect(saved.title).toBe('Tram 28 to Graça')
      expect(saved.day).toBe('2027-03-02') // where it was, untouched
    })
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
    const user = userEvent.setup()
    renderPlan()
    await openEditor(user)

    // Outside the trip. The message below is the server's own wording, so this
    // case fails if that rule is reworded or dropped — which is the point.
    await user.clear(screen.getByLabelText('Day'))
    await user.type(screen.getByLabelText('Day'), '2027-04-20')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/day must fall within the trip's dates/)).toBeInTheDocument()
  })
})
