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
  start_date: '2027-03-01',
  end_date: '2027-03-08',
  description: null,
  people: [],
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

  it('blocks on a stranded stop — those are fixed on the journey editor', async () => {
    const user = userEvent.setup()
    mocks.get.mockResolvedValue({
      ...IMPACT,
      steps: [{ id: 's1', start_date: '2027-03-05', end_date: '2027-03-08', zone_name: 'Sintra' }],
      items: [],
    })
    renderSheet({ mode: 'edit', trip: TRIP })

    await shortenEndDate(user)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText(/1 stop falls outside/i)).toBeInTheDocument()
    expect(screen.getByText('Sintra')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
    expect(mocks.patch).not.toHaveBeenCalled()
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

  it('adds a traveller with an email and shows a mailto invite link', async () => {
    const user = userEvent.setup()
    renderSheet()
    await user.type(screen.getByLabelText('Traveller name'), 'Noa')
    await user.type(screen.getByLabelText('Traveller email (optional)'), 'noa@example.com')
    await user.click(screen.getByRole('button', { name: 'Add traveller' }))

    const invite = screen.getByRole('link', { name: /invite/i })
    expect(invite.getAttribute('href')).toMatch(/^mailto:noa%40example\.com\?/)
    expect(invite.getAttribute('href')).toContain('subject=')
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
