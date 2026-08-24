import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { PARTNER_USER, VIEWER_USER } from '../../server/testing/fixture'
import { TripSheet } from '../components/TripSheet'
import type { Trip } from '../api/types'
import { insert, patchTrip, remove, rows, signInAs } from './data'

// The impact of a date change is the server's calculation — these cases seed
// the stops and activities that make it come out one way or another, and check
// what the sheet does with the answer.

interface ItemRow {
  id: string
  day: string
}
interface StepRow {
  id: string
  start_date: string
  end_date: string
}
interface TripRow {
  end_date: string
}
interface InviteRow {
  email: string
  role: string
  can_see_flight: boolean
  can_see_stays: boolean
}

const TRIP: Trip = {
  id: 'trip-1',
  name: 'Lisbon',
  country: 'Japan',
  display_title: 'Lisbon',
  start_date: '2027-03-01',
  end_date: '2027-03-08',
  description: null,
  people: [],
  local_currency: 'JPY',
  home_currencies: ['USD', 'ILS'],
  start_time: null,
  start_tz: null,
}

function renderSheet(props: Partial<Parameters<typeof TripSheet>[0]> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <TripSheet mode="add" onClose={() => {}} {...props} />
    </QueryClientProvider>
  )
}

const setEndDay = (user: ReturnType<typeof userEvent.setup>, day: string) =>
  user.selectOptions(screen.getByLabelText('End day'), day)

/** Shorten the trip to Mar 4, which strands anything planned after it. */
const shortenEndDate = (user: ReturnType<typeof userEvent.setup>) => setEndDay(user, '04')

/** Two activities in the week the trip is about to lose. */
const strandedActivities = () =>
  insert('itinerary_items', [
    { id: 'i1', trip_id: 'trip-1', day: '2027-03-06', start_time: '09:00', title: 'Tram 28' },
    { id: 'i2', trip_id: 'trip-1', day: '2027-03-07', title: 'Time Out Market' },
  ])

/** A stop in that week too, so the sheet has both kinds to resolve. */
async function strandedStop(range = { start_date: '2027-03-05', end_date: '2027-03-08' }) {
  await insert('zones', [{ id: 'zone-sintra', trip_id: 'trip-1', name: 'Sintra' }])
  await insert('journey_steps', [
    { id: 's1', trip_id: 'trip-1', zone_id: 'zone-sintra', position: 1, ...range },
  ])
}

describe('TripSheet date changes that strand activities', () => {
  beforeEach(async () => {
    // A week in Lisbon with nothing planned; each case adds what it needs.
    await remove('journey_steps', 'trip_id', 'trip-1')
    await remove('itinerary_items', 'trip_id', 'trip-1')
    await patchTrip('trip-1', {
      name: 'Lisbon',
      country: 'Japan',
      start_date: '2027-03-01',
      end_date: '2027-03-08',
      people: [],
    })
  })

  it('saves straight through when the new dates strand nothing', async () => {
    const user = userEvent.setup()
    renderSheet({ mode: 'edit', trip: TRIP })

    await shortenEndDate(user)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(async () => {
      const [trip] = await rows<TripRow>('trips', 'id', 'trip-1')
      expect(trip.end_date).toBe('2027-03-04')
    })
  })

  it('lists the stranded activities and moves them to the first day by default', async () => {
    const user = userEvent.setup()
    await strandedActivities()
    renderSheet({ mode: 'edit', trip: TRIP })

    await shortenEndDate(user)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    // Nothing is written until the traveller has answered.
    expect(await screen.findByText(/2 activities fall outside/i)).toBeInTheDocument()
    expect((await rows<TripRow>('trips', 'id', 'trip-1'))[0].end_date).toBe('2027-03-08')

    // The list is collapsed; expanding it shows every stranded activity.
    await user.click(screen.getByText('Show them'))
    expect(screen.getByText('Tram 28')).toBeInTheDocument()
    expect(screen.getByText('Time Out Market')).toBeInTheDocument()

    expect(screen.getByRole('radio', { name: /Move to the first day/ })).toBeChecked()
    await user.click(screen.getByRole('button', { name: /Move 2 activities & save/ }))

    await waitFor(async () => {
      const items = await rows<ItemRow>('itinerary_items', 'trip_id', 'trip-1')
      expect(items.map((i) => i.day)).toEqual(['2027-03-01', '2027-03-01'])
    })
  })

  it('deletes them instead when that is chosen', async () => {
    const user = userEvent.setup()
    await strandedActivities()
    renderSheet({ mode: 'edit', trip: TRIP })

    await shortenEndDate(user)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByText(/2 activities fall outside/i)

    await user.click(screen.getByRole('radio', { name: /Delete them/ }))
    await user.click(screen.getByRole('button', { name: /Delete 2 activities & save/ }))

    await waitFor(async () => {
      expect(await rows<ItemRow>('itinerary_items', 'trip_id', 'trip-1')).toEqual([])
    })
  })

  it('brings a stranded stop along instead of dead-ending on it', async () => {
    const user = userEvent.setup()
    await strandedStop()
    renderSheet({ mode: 'edit', trip: TRIP })

    await shortenEndDate(user)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText(/1 stop falls outside/i)).toBeInTheDocument()
    expect(screen.getByText('Sintra')).toBeInTheDocument()
    // Telling the traveller to fix it on the journey editor first was a
    // deadlock: a stop cannot leave the window the trip still has.
    expect(screen.getByText(/It moves to the first day/i)).toBeInTheDocument()

    const save = screen.getByRole('button', { name: /Move 1 stop & save/ })
    expect(save).toBeEnabled()
    await user.click(save)

    await waitFor(async () => {
      const [step] = await rows<StepRow>('journey_steps', 'id', 's1')
      expect(step).toMatchObject({ start_date: '2027-03-01', end_date: '2027-03-04' })
    })
  })

  it('says a stop is shortened rather than claiming it keeps its length', async () => {
    const user = userEvent.setup()
    // A 4-night stay on what is about to be a 2-day trip: it cannot survive intact.
    await strandedStop({ start_date: '2027-03-01', end_date: '2027-03-05' })
    renderSheet({ mode: 'edit', trip: TRIP })

    await setEndDay(user, '02')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByText(/1 stop falls outside/i)

    expect(screen.getByText(/shortened to 1 night \(was 4\)/i)).toBeInTheDocument()
    expect(screen.getByText(/clipped where the trip is no longer long enough/i)).toBeInTheDocument()
    expect(screen.queryByText(/keeping its length/i)).not.toBeInTheDocument()
  })

  it('resolves stops and activities in one save', async () => {
    const user = userEvent.setup()
    await strandedStop()
    await strandedActivities()
    renderSheet({ mode: 'edit', trip: TRIP })

    await shortenEndDate(user)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByText(/1 stop falls outside/i)

    // Both are named, and the activity choice is live — nothing is blocking.
    expect(screen.getByText(/2 activities fall outside/i)).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /Delete them/ }))

    await user.click(
      screen.getByRole('button', { name: /Move 1 stop & delete 2 activities & save/ })
    )

    await waitFor(async () => {
      expect(await rows<ItemRow>('itinerary_items', 'trip_id', 'trip-1')).toEqual([])
      const [step] = await rows<StepRow>('journey_steps', 'id', 's1')
      expect(step.end_date).toBe('2027-03-04')
    })
  })

  it('says what moving a crowd of activities onto one day costs', async () => {
    const user = userEvent.setup()
    await insert(
      'itinerary_items',
      Array.from({ length: 9 }, (_, i) => ({
        id: `i${i}`,
        trip_id: 'trip-1',
        day: '2027-03-06',
        title: `Activity ${i}`,
      }))
    )
    renderSheet({ mode: 'edit', trip: TRIP })

    await shortenEndDate(user)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByText(/9 activities fall outside/i)

    expect(screen.getByText(/stacks 9 activities onto one day/i)).toBeInTheDocument()
    // Deleting them carries no such warning.
    await user.click(screen.getByRole('radio', { name: /Delete them/ }))
    expect(screen.queryByText(/stacks 9 activities/i)).not.toBeInTheDocument()
  })

  it('re-checks after the dates are edited again', async () => {
    const user = userEvent.setup()
    await strandedActivities()
    renderSheet({ mode: 'edit', trip: TRIP })

    await shortenEndDate(user)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByText(/2 activities fall outside/i)

    // Put the week back: nothing is stranded any more, and the server says so.
    await setEndDay(user, '08')
    await waitFor(() =>
      expect(screen.queryByText(/activities fall outside/i)).not.toBeInTheDocument()
    )

    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(async () => {
      const items = await rows<ItemRow>('itinerary_items', 'trip_id', 'trip-1')
      expect(items.map((i) => i.day).sort()).toEqual(['2027-03-06', '2027-03-07'])
    })
  })
})

describe('TripSheet travellers', () => {
  it('adds a traveller with just a name', async () => {
    const user = userEvent.setup()
    renderSheet()
    await user.type(screen.getByLabelText('Traveller name'), 'Noa')
    await user.click(screen.getByRole('button', { name: 'Add traveller' }))
    expect(screen.getByText('Noa')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /invite/i })).not.toBeInTheDocument()
  })

  it('cannot invite from a trip that does not exist yet, and says so', async () => {
    // An invitation belongs to a trip. In add mode there isn't one, so the
    // roster takes the email now and offers the invite after saving.
    const user = userEvent.setup()
    renderSheet()
    await user.type(screen.getByLabelText('Traveller name'), 'Noa')
    await user.type(screen.getByLabelText('Traveller email (optional)'), 'noa@example.com')
    await user.click(screen.getByRole('button', { name: 'Add traveller' }))

    expect(screen.getByText('Noa')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Invite' })).not.toBeInTheDocument()
    expect(screen.getByText(/invite them once the trip is saved/i)).toBeInTheDocument()
  })

  it('rejects an invalid email instead of adding the traveller', async () => {
    const user = userEvent.setup()
    renderSheet()
    await user.type(screen.getByLabelText('Traveller name'), 'Noa')
    await user.type(screen.getByLabelText('Traveller email (optional)'), 'not-an-email')
    await user.click(screen.getByRole('button', { name: 'Add traveller' }))

    expect(screen.getByText(/doesn't look like a valid email/i)).toBeInTheDocument()
    expect(screen.queryByText('Noa')).not.toBeInTheDocument()
  })

  it('removes a traveller', async () => {
    const user = userEvent.setup()
    renderSheet()
    await user.type(screen.getByLabelText('Traveller name'), 'Noa')
    await user.click(screen.getByRole('button', { name: 'Add traveller' }))
    expect(screen.getByText('Noa')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove Noa' }))
    expect(screen.queryByText('Noa')).not.toBeInTheDocument()
  })
})

// Inviting from the roster, with the same access controls the members screen
// uses — the point being that "add their email" and "decide what they see" are
// one gesture rather than two screens.
describe('TripSheet — inviting a traveller', () => {
  const withRoster = { ...TRIP, people: [{ name: 'Noa', email: 'noa@example.com' }] }

  beforeEach(async () => {
    await remove('journey_steps', 'trip_id', 'trip-1')
    await remove('itinerary_items', 'trip_id', 'trip-1')
    await patchTrip('trip-1', { ...withRoster, display_title: undefined, id: undefined })
  })

  it('offers an owner both roles, and mints the invitation with what was chosen', async () => {
    const user = userEvent.setup()
    renderSheet({ mode: 'edit', trip: withRoster })

    await user.click(await screen.findByRole('button', { name: 'Invite' }))
    expect(screen.getByText(/waiting for them the next time they sign in/i)).toBeInTheDocument()

    // Default is a viewer who sees the bookings but not the documents.
    await user.click(screen.getByLabelText(/Flights/))
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))

    await waitFor(async () => {
      const [minted] = await rows<InviteRow>('trip_invites', 'trip_id', 'trip-1')
      expect(minted).toMatchObject({
        email: 'noa@example.com',
        role: 'viewer',
        can_see_stays: true,
        can_see_flight: false,
      })
    })
  })

  it('offers a partner viewer only — write access cannot spread sideways', async () => {
    const user = userEvent.setup()
    await insert('trip_members', [
      {
        trip_id: 'trip-1',
        user_id: PARTNER_USER.id,
        role: 'partner',
        can_see_stays: true,
        can_see_flight: true,
        can_see_documents: true,
        can_see_shopping: true,
      },
    ])
    signInAs(PARTNER_USER)
    renderSheet({ mode: 'edit', trip: withRoster })

    await user.click(await screen.findByRole('button', { name: 'Invite' }))
    expect(screen.getByLabelText(/View only/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Partner/)).not.toBeInTheDocument()
  })

  it('says where someone already stands instead of offering to invite again', async () => {
    // The roster names them in upper case; membership is matched on the
    // address, which is case-insensitive.
    await patchTrip('trip-1', {
      people: [{ name: 'Friend', email: VIEWER_USER.email.toUpperCase() }],
    })
    await insert('trip_members', [
      { trip_id: 'trip-1', user_id: VIEWER_USER.id, role: 'viewer', can_see_stays: true },
    ])
    renderSheet({
      mode: 'edit',
      trip: { ...TRIP, people: [{ name: 'Friend', email: VIEWER_USER.email.toUpperCase() }] },
    })

    expect(await screen.findByText('On trip')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Invite' })).not.toBeInTheDocument()
  })

  it('shows an outstanding invitation as already sent', async () => {
    await insert('trip_invites', [
      {
        id: 'inv-1',
        trip_id: 'trip-1',
        email: 'noa@example.com',
        role: 'viewer',
        token_hash: 'not-a-real-hash',
        expires_at: '2027-01-01T00:00:00.000Z',
      },
    ])
    renderSheet({ mode: 'edit', trip: withRoster })

    expect(await screen.findByText('Invited')).toBeInTheDocument()
  })

  it('offers again once they have declined', async () => {
    await insert('trip_invites', [
      {
        id: 'inv-1',
        trip_id: 'trip-1',
        email: 'noa@example.com',
        role: 'viewer',
        token_hash: 'not-a-real-hash',
        expires_at: '2027-01-01T00:00:00.000Z',
        declined_at: '2026-08-22T00:00:00Z',
      },
    ])
    renderSheet({ mode: 'edit', trip: withRoster })

    expect(await screen.findByRole('button', { name: 'Invite' })).toBeInTheDocument()
  })
})
