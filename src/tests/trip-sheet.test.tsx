import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TripSheet } from '../components/TripSheet'
import type { Trip } from '../api/types'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: mocks,
}))

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

/** The year dropdown offers this year - 1 through this year + 5. */
const thisYear = new Date().getFullYear()

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

/** Shorten the trip to Mar 4, which strands anything planned after it. */
async function shortenEndDate(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText('End day'), '04')
}

const IMPACT = {
  range: { start_date: '2027-03-01', end_date: '2027-03-04' },
  steps: [],
  items: [
    { id: 'i1', day: '2027-03-06', start_time: '09:00', title: 'Tram 28', highlight: false },
    { id: 'i2', day: '2027-03-07', start_time: null, title: 'Time Out Market', highlight: false },
  ],
}

describe('TripSheet date changes that strand activities', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.patch.mockReset()
    mocks.patch.mockResolvedValue({ trip: TRIP })
  })

  it('saves straight through when the new dates strand nothing', async () => {
    const user = userEvent.setup()
    mocks.get.mockResolvedValue({ ...IMPACT, items: [] })
    renderSheet({ mode: 'edit', trip: TRIP })

    await shortenEndDate(user)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(mocks.patch).toHaveBeenCalled())
    expect(mocks.patch.mock.calls[0][1]).toMatchObject({ end_date: '2027-03-04' })
    expect(mocks.patch.mock.calls[0][1].stranded_activities).toBeUndefined()
  })

  it('lists the stranded activities and moves them to the first day by default', async () => {
    const user = userEvent.setup()
    mocks.get.mockResolvedValue(IMPACT)
    renderSheet({ mode: 'edit', trip: TRIP })

    await shortenEndDate(user)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    // Nothing is written until the traveller has answered.
    expect(await screen.findByText(/2 activities fall outside/i)).toBeInTheDocument()
    expect(mocks.patch).not.toHaveBeenCalled()

    // The list is collapsed; expanding it shows every stranded activity.
    await user.click(screen.getByText('Show them'))
    expect(screen.getByText('Tram 28')).toBeInTheDocument()
    expect(screen.getByText('Time Out Market')).toBeInTheDocument()

    expect(screen.getByRole('radio', { name: /Move to the first day/ })).toBeChecked()
    await user.click(screen.getByRole('button', { name: /Move 2 activities & save/ }))

    await waitFor(() => expect(mocks.patch).toHaveBeenCalled())
    expect(mocks.patch.mock.calls[0][1]).toMatchObject({
      end_date: '2027-03-04',
      stranded_activities: 'move',
    })
  })

  it('deletes them instead when that is chosen', async () => {
    const user = userEvent.setup()
    mocks.get.mockResolvedValue(IMPACT)
    renderSheet({ mode: 'edit', trip: TRIP })

    await shortenEndDate(user)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByText(/2 activities fall outside/i)

    await user.click(screen.getByRole('radio', { name: /Delete them/ }))
    await user.click(screen.getByRole('button', { name: /Delete 2 activities & save/ }))

    await waitFor(() => expect(mocks.patch).toHaveBeenCalled())
    expect(mocks.patch.mock.calls[0][1]).toMatchObject({ stranded_activities: 'delete' })
  })

  it('brings a stranded stop along instead of dead-ending on it', async () => {
    const user = userEvent.setup()
    mocks.get.mockResolvedValue({
      ...IMPACT,
      steps: [
        {
          id: 's1',
          start_date: '2027-03-05',
          end_date: '2027-03-08',
          zone_name: 'Sintra',
          moves_to: { start_date: '2027-03-01', end_date: '2027-03-04' },
        },
      ],
      items: [],
    })
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

    await waitFor(() => expect(mocks.patch).toHaveBeenCalled())
    expect(mocks.patch.mock.calls[0][1]).toMatchObject({ stranded_stops: 'move' })
    expect(mocks.patch.mock.calls[0][1].stranded_activities).toBeUndefined()
  })

  it('says a stop is shortened rather than claiming it keeps its length', async () => {
    const user = userEvent.setup()
    mocks.get.mockResolvedValue({
      range: { start_date: '2027-03-01', end_date: '2027-03-02' },
      // A 4-night stay on what is now a 2-day trip: it cannot survive intact.
      steps: [
        {
          id: 's1',
          start_date: '2027-03-01',
          end_date: '2027-03-05',
          zone_name: 'Porto',
          moves_to: { start_date: '2027-03-01', end_date: '2027-03-02' },
        },
      ],
      items: [],
    })
    renderSheet({ mode: 'edit', trip: TRIP })

    await shortenEndDate(user)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByText(/1 stop falls outside/i)

    expect(screen.getByText(/shortened to 1 night \(was 4\)/i)).toBeInTheDocument()
    expect(screen.getByText(/clipped where the trip is no longer long enough/i)).toBeInTheDocument()
    expect(screen.queryByText(/keeping its length/i)).not.toBeInTheDocument()
  })

  it('resolves stops and activities in one save', async () => {
    const user = userEvent.setup()
    mocks.get.mockResolvedValue({
      ...IMPACT,
      steps: [
        {
          id: 's1',
          start_date: '2027-03-05',
          end_date: '2027-03-08',
          zone_name: 'Sintra',
          moves_to: { start_date: '2027-03-01', end_date: '2027-03-04' },
        },
      ],
    })
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
    await waitFor(() => expect(mocks.patch).toHaveBeenCalled())
    expect(mocks.patch.mock.calls[0][1]).toMatchObject({
      stranded_stops: 'move',
      stranded_activities: 'delete',
    })
  })

  it('says what moving a crowd of activities onto one day costs', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 9 }, (_, i) => ({
      id: `i${i}`,
      day: '2027-03-06',
      start_time: null,
      title: `Activity ${i}`,
      highlight: false,
    }))
    mocks.get.mockResolvedValue({ ...IMPACT, items: many })
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
    mocks.get.mockResolvedValue(IMPACT)
    renderSheet({ mode: 'edit', trip: TRIP })

    await shortenEndDate(user)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByText(/2 activities fall outside/i)

    mocks.get.mockResolvedValue({ ...IMPACT, items: [] })
    await user.selectOptions(screen.getByLabelText('End day'), '06')
    expect(screen.queryByText(/activities fall outside/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(mocks.patch).toHaveBeenCalled())
    expect(mocks.patch.mock.calls[0][1].stranded_activities).toBeUndefined()
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

  /** The three GETs the sheet makes in edit mode. */
  function mockTrip({
    my_role = 'owner',
    members = [] as unknown[],
    invites = [] as unknown[],
  } = {}) {
    mocks.get.mockImplementation((path: string) => {
      if (path === '/trips/trip-1') return Promise.resolve({ trip: withRoster, steps: [], my_role })
      if (path === '/trips/trip-1/members') return Promise.resolve({ members })
      if (path === '/trips/trip-1/invites') return Promise.resolve({ invites })
      return Promise.resolve(IMPACT)
    })
  }

  beforeEach(() => {
    mocks.get.mockReset()
    mocks.post.mockReset()
  })

  it('offers an owner both roles, and mints the invitation with what was chosen', async () => {
    const user = userEvent.setup()
    mockTrip()
    mocks.post.mockResolvedValue({ invite: { id: 'inv-1' }, token: 'tok' })
    renderSheet({ mode: 'edit', trip: withRoster })

    await user.click(await screen.findByRole('button', { name: 'Invite' }))
    expect(screen.getByText(/waiting for them the next time they sign in/i)).toBeInTheDocument()

    // Default is a viewer who sees the bookings but not the documents.
    await user.click(screen.getByLabelText(/Flights/))
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/trips/trip-1/invites', {
        role: 'viewer',
        email: 'noa@example.com',
        can_see_stays: true,
        can_see_flight: false,
        can_see_shopping: true,
        can_see_documents: false,
      })
    )
  })

  it('offers a partner viewer only — write access cannot spread sideways', async () => {
    const user = userEvent.setup()
    mockTrip({ my_role: 'partner' })
    renderSheet({ mode: 'edit', trip: withRoster })

    await user.click(await screen.findByRole('button', { name: 'Invite' }))
    expect(screen.getByLabelText(/View only/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Partner/)).not.toBeInTheDocument()
  })

  it('says where someone already stands instead of offering to invite again', async () => {
    mockTrip({ members: [{ user_id: 'u1', role: 'viewer', email: 'NOA@example.com' }] })
    renderSheet({ mode: 'edit', trip: withRoster })

    // Matched case-insensitively, as email is.
    expect(await screen.findByText('On trip')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Invite' })).not.toBeInTheDocument()
  })

  it('shows an outstanding invitation as already sent', async () => {
    mockTrip({ invites: [{ id: 'inv-1', email: 'noa@example.com', role: 'viewer' }] })
    renderSheet({ mode: 'edit', trip: withRoster })

    expect(await screen.findByText('Invited')).toBeInTheDocument()
  })

  it('offers again once they have declined', async () => {
    mockTrip({
      invites: [
        {
          id: 'inv-1',
          email: 'noa@example.com',
          role: 'viewer',
          declined_at: '2026-08-22T00:00:00Z',
        },
      ],
    })
    renderSheet({ mode: 'edit', trip: withRoster })

    expect(await screen.findByRole('button', { name: 'Invite' })).toBeInTheDocument()
  })
})

// The name is an override, not the title — leaving it empty means "name it
// after who is going and where". The form said so ("Name it (optional)") while
// refusing to submit without one, and said nothing about why, because the only
// signal was a disabled button.
describe('TripSheet — creating a trip', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    // The sheet asks for the currency catalogue on open; in add mode there is
    // no trip to fetch, so this is the only GET it makes.
    mocks.get.mockResolvedValue({ currencies: [], by_country: {} })
    mocks.post.mockReset()
    mocks.post.mockResolvedValue({ trip: TRIP })
  })

  /** Fill in the two things a trip genuinely cannot be created without. */
  async function pickDates(user: ReturnType<typeof userEvent.setup>) {
    await user.selectOptions(screen.getByLabelText('Start day'), '01')
    await user.selectOptions(screen.getByLabelText('Start month'), '03')
    await user.selectOptions(screen.getByLabelText('Start year'), String(thisYear + 1))
    await user.selectOptions(screen.getByLabelText('End day'), '08')
    await user.selectOptions(screen.getByLabelText('End month'), '03')
    await user.selectOptions(screen.getByLabelText('End year'), String(thisYear + 1))
  }

  it('creates a trip with no name, since the name is optional', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderSheet({ onClose })

    await pickDates(user)
    await user.click(screen.getByRole('button', { name: 'Create trip' }))

    await waitFor(() => expect(mocks.post).toHaveBeenCalled())
    expect(mocks.post.mock.calls[0][1]).toMatchObject({
      name: '',
      start_date: `${thisYear + 1}-03-01`,
      end_date: `${thisYear + 1}-03-08`,
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('creates a trip with no country either — only the dates are required', async () => {
    const user = userEvent.setup()
    renderSheet()

    await pickDates(user)
    await user.click(screen.getByRole('button', { name: 'Create trip' }))

    await waitFor(() => expect(mocks.post).toHaveBeenCalled())
    expect(mocks.post.mock.calls[0][1]).toMatchObject({ name: '', country: '' })
  })

  it('says what is missing instead of going quiet, and does not send', async () => {
    const user = userEvent.setup()
    renderSheet()

    await user.click(screen.getByRole('button', { name: 'Create trip' }))

    expect(screen.getByText(/pick the day, month and year the trip starts/i)).toBeInTheDocument()
    expect(screen.getByText(/pick the day, month and year the trip ends/i)).toBeInTheDocument()
    expect(screen.getByText(/2 things still need fixing/i)).toBeInTheDocument()
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('never blames the name, however empty the form is', async () => {
    const user = userEvent.setup()
    renderSheet()

    await user.click(screen.getByRole('button', { name: 'Create trip' }))

    expect(screen.queryByText(/name is required/i)).not.toBeInTheDocument()
    expect(
      screen
        .getAllByRole('alert')
        .map((n) => n.textContent)
        .join(' ')
    ).not.toMatch(/name/i)
  })

  it('stays quiet about missing fields until Save is actually pressed', async () => {
    renderSheet()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('clears each message as its field is filled in, and then saves', async () => {
    const user = userEvent.setup()
    renderSheet()

    await user.click(screen.getByRole('button', { name: 'Create trip' }))
    expect(screen.getByText(/2 things still need fixing/i)).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Start day'), '01')
    await user.selectOptions(screen.getByLabelText('Start month'), '03')
    await user.selectOptions(screen.getByLabelText('Start year'), String(thisYear + 1))
    expect(screen.getByText(/one thing still needs fixing/i)).toBeInTheDocument()
    expect(
      screen.queryByText(/pick the day, month and year the trip starts/i)
    ).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('End day'), '08')
    await user.selectOptions(screen.getByLabelText('End month'), '03')
    await user.selectOptions(screen.getByLabelText('End year'), String(thisYear + 1))
    expect(screen.queryByText(/still need/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Create trip' }))
    await waitFor(() => expect(mocks.post).toHaveBeenCalled())
  })

  it('flags an end date before the start date without waiting for Save', async () => {
    const user = userEvent.setup()
    renderSheet()

    await pickDates(user)
    await user.selectOptions(screen.getByLabelText('End day'), '01')
    await user.selectOptions(screen.getByLabelText('End month'), '02')

    // Both sides are filled in and they disagree — nothing is pending, so
    // there is nothing to wait for.
    expect(screen.getByText(/end date is before the start date/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Create trip' }))
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('keeps the last currency rather than letting the form reach an unsavable state', async () => {
    const user = userEvent.setup()
    renderSheet()

    await user.click(screen.getByRole('button', { name: 'Remove USD' }))
    // A calculator with nothing on the right side has nothing to say, so the
    // last chip has no Remove at all — the currency blocker below is the
    // backstop for a state the UI does not offer a way into.
    expect(screen.queryByRole('button', { name: 'Remove ILS' })).not.toBeInTheDocument()

    await pickDates(user)
    await user.click(screen.getByRole('button', { name: 'Create trip' }))
    await waitFor(() => expect(mocks.post).toHaveBeenCalled())
    expect(mocks.post.mock.calls[0][1]).toMatchObject({ home_currencies: ['ILS'] })
  })
})
