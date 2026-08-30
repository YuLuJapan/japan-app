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
  country_code: 'JP',
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

// The sheet asks for the country list on open (spec 008) — it is what decides
// whether what is in the country field is a country, so every GET mock in this
// file has to answer for it. A list that never arrives is a different case, and
// has its own test.
const COUNTRIES = {
  countries: [
    { code: 'JP', name: 'Japan' },
    { code: 'PT', name: 'Portugal' },
    { code: 'GB', name: 'United Kingdom', aliases: ['UK', 'England'] },
  ],
}

/** Everything the sheet fetches: the country list, and whatever a test is about. */
const getReturns = (rest: unknown) =>
  mocks.get.mockImplementation((path: string) => {
    if (path === '/countries') return Promise.resolve(COUNTRIES)
    if (path === '/currencies') return Promise.resolve({ currencies: [], by_country: {} })
    return Promise.resolve(rest)
  })

describe('TripSheet date changes that strand activities', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.patch.mockReset()
    mocks.patch.mockResolvedValue({ trip: TRIP })
  })

  it('saves straight through when the new dates strand nothing', async () => {
    const user = userEvent.setup()
    getReturns({ ...IMPACT, items: [] })
    renderSheet({ mode: 'edit', trip: TRIP })

    await shortenEndDate(user)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(mocks.patch).toHaveBeenCalled())
    expect(mocks.patch.mock.calls[0][1]).toMatchObject({ end_date: '2027-03-04' })
    expect(mocks.patch.mock.calls[0][1].stranded_activities).toBeUndefined()
  })

  it('lists the stranded activities and moves them to the first day by default', async () => {
    const user = userEvent.setup()
    getReturns(IMPACT)
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
    getReturns(IMPACT)
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
    getReturns({
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
    getReturns({
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
    getReturns({
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
    getReturns({ ...IMPACT, items: many })
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
    getReturns(IMPACT)
    renderSheet({ mode: 'edit', trip: TRIP })

    await shortenEndDate(user)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByText(/2 activities fall outside/i)

    getReturns({ ...IMPACT, items: [] })
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
      if (path === '/countries') return Promise.resolve(COUNTRIES)
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
// Spec 008, US3. Every trip in the database predates the country list, and three
// of them hold something the list cannot match ('Amsterdam', 'IL',
// 'Japan & Seoul'). Nothing rewrites them behind the traveller's back — but the
// moment they open the sheet and save, they are told, because a country that is
// not a country quietly decides the currency guess and the Essentials content.
describe('TripSheet — a trip from before the country list', () => {
  const LEGACY: Trip = { ...TRIP, country: 'Amsterdam', country_code: null }

  beforeEach(() => {
    mocks.get.mockReset()
    mocks.patch.mockReset()
    mocks.patch.mockResolvedValue({ trip: LEGACY })
    getReturns({ ...IMPACT, items: [] })
  })

  it('shows the stored text as it was typed', async () => {
    renderSheet({ mode: 'edit', trip: LEGACY })
    const field = (await screen.findByLabelText('Country')) as HTMLInputElement
    expect(field.value).toBe('Amsterdam')
  })

  it('refuses to save it, and says what to do about it', async () => {
    const user = userEvent.setup()
    renderSheet({ mode: 'edit', trip: LEGACY })

    await user.click(await screen.findByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText(/choose a country from the list/i)).toBeInTheDocument()
    expect(mocks.patch).not.toHaveBeenCalled()
  })

  it('lets it through once the country is emptied — null is a valid answer', async () => {
    const user = userEvent.setup()
    renderSheet({ mode: 'edit', trip: LEGACY })

    await user.clear(await screen.findByLabelText('Country'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(mocks.patch).toHaveBeenCalled())
    expect(mocks.patch.mock.calls[0][1]).toMatchObject({ country_code: null })
  })

  it('lets it through once a real country is chosen', async () => {
    const user = userEvent.setup()
    renderSheet({ mode: 'edit', trip: LEGACY })

    const field = await screen.findByLabelText('Country')
    await user.clear(field)
    await user.type(field, 'Portugal')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(mocks.patch).toHaveBeenCalled())
    expect(mocks.patch.mock.calls[0][1]).toMatchObject({ country_code: 'PT' })
  })

  // The list is one request, and a cold function or a dead connection can lose
  // it. Nothing about the country may be judged — or written — without it.
  it('says nothing, and sends nothing, while the list has not arrived', async () => {
    const user = userEvent.setup()
    mocks.get.mockImplementation((path: string) =>
      path === '/countries' ? new Promise(() => {}) : Promise.resolve({ ...IMPACT, items: [] })
    )
    renderSheet({ mode: 'edit', trip: LEGACY })

    await user.click(await screen.findByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(mocks.patch).toHaveBeenCalled())
    expect(screen.queryByText(/choose a country from the list/i)).not.toBeInTheDocument()
    // Neither field is mentioned, so the API leaves both columns alone.
    expect(mocks.patch.mock.calls[0][1]).not.toHaveProperty('country_code')
    expect(mocks.patch.mock.calls[0][1]).not.toHaveProperty('country')
  })
})

describe('TripSheet — creating a trip', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    // The sheet asks for the currency catalogue on open; in add mode there is
    // no trip to fetch, so this is the only GET it makes.
    getReturns({})
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
    // Nothing typed means no country: the code is null and the server clears
    // the pair. Empty is a legitimate answer, not a blocker.
    expect(mocks.post.mock.calls[0][1]).toMatchObject({ name: '', country_code: null })
  })

  // Spec 008. The country stops being free text: something that is not a
  // country is refused with a message beside the field, rather than saved,
  // silently emptied, or corrected to the nearest match.
  it('refuses a country that is not on the list, and says so beside the field', async () => {
    const user = userEvent.setup()
    renderSheet()

    await pickDates(user)
    await user.type(screen.getByLabelText('Country'), 'Jappan')
    await user.click(screen.getByRole('button', { name: 'Create trip' }))

    expect(await screen.findByText(/choose a country from the list/i)).toBeInTheDocument()
    expect(mocks.post).not.toHaveBeenCalled()
    // And what was typed is still there to correct — not cleared under them.
    expect((screen.getByLabelText('Country') as HTMLInputElement).value).toBe('Jappan')
  })

  it('takes a country that is on the list, and sends its code', async () => {
    const user = userEvent.setup()
    renderSheet()

    await pickDates(user)
    await user.type(screen.getByLabelText('Country'), 'Japan')
    await user.click(screen.getByRole('button', { name: 'Create trip' }))

    await waitFor(() => expect(mocks.post).toHaveBeenCalled())
    expect(mocks.post.mock.calls[0][1]).toMatchObject({ country_code: 'JP' })
    expect(screen.queryByText(/choose a country from the list/i)).not.toBeInTheDocument()
  })

  it('matches a name the list knows by another spelling', async () => {
    const user = userEvent.setup()
    renderSheet()

    await pickDates(user)
    await user.type(screen.getByLabelText('Country'), 'england')
    await user.click(screen.getByRole('button', { name: 'Create trip' }))

    await waitFor(() => expect(mocks.post).toHaveBeenCalled())
    expect(mocks.post.mock.calls[0][1]).toMatchObject({ country_code: 'GB' })
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
