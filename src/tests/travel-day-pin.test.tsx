// Which city a new activity is pinned to, and who decides.
//
// Every activity belongs to a city. A city page knows the answer — the city you are
// looking at, whatever the date. The trip screen infers it from the journey, which
// works every day but a moving one: `primaryStep` answers "the city you sleep in that
// night", so the morning you spend leaving was being stamped with the city you were
// flying into. On a shared day the trip screen therefore asks instead of guessing.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Schedule } from '../components/Schedule'
import type { TripStep } from '../api/types'
import { renderAt } from './helpers'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }))

const ITEM = {
  id: 'i1',
  trip_id: 'trip-1',
  zone_id: 'z2',
  place_id: null,
  day: '2026-10-09',
  start_time: '09:00',
  title: 'Last coffee',
  note: null,
  position: 0,
  highlight: false,
  icon: null,
}

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: mocks,
}))

const counts = { hotel: 0, attraction: 0, food: 0, shopping: 0, other: 0 }
const zone = (id: string, name: string) => ({
  id,
  name,
  name_ja: null,
  summary: null,
  place_counts: counts,
})

// Tokyo Oct 5–9, Kyoto Oct 9–12: the 9th is the moving day, the 6th is not.
const steps: TripStep[] = [
  {
    id: 's1',
    position: 1,
    start_date: '2026-10-05',
    end_date: '2026-10-09',
    zone: zone('z1', 'Tokyo'),
  },
  {
    id: 's2',
    position: 2,
    start_date: '2026-10-09',
    end_date: '2026-10-12',
    zone: zone('z2', 'Kyoto'),
  },
]

const TRIP_BUNDLE = {
  trip: {
    id: 'trip-1',
    name: 'Japan',
    country: 'Japan',
    display_title: 'Japan',
    start_date: '2026-10-05',
    end_date: '2026-10-12',
    description: null,
    people: [],
  },
  steps,
  trip_files_count: 0,
  flight: null,
}

/** Renders the schedule on `today` with `items` already on the day. */
const renderSchedule = (
  today: string,
  props: { mode: 'trip' | 'zone'; zoneId?: string } = { mode: 'trip' },
  items: (typeof ITEM)[] = []
) =>
  renderAt('/trips/trip-1', [
    {
      path: '/trips/:tripId',
      element: (
        <Schedule
          {...props}
          steps={steps}
          items={items}
          days={['2026-10-06', '2026-10-09']}
          today={today}
          tripId="trip-1"
        />
      ),
    },
  ])

/** Renders the schedule on `today` and opens the add form. */
const openAddForm = async (
  today: string,
  props: { mode: 'trip' | 'zone'; zoneId?: string } = { mode: 'trip' }
) => {
  renderSchedule(today, props)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '+ Add activity' }))
  await user.type(screen.getByLabelText('Activity'), 'Breakfast')
  return user
}

const patched = async () => {
  await waitFor(() => expect(mocks.patch).toHaveBeenCalled())
  return mocks.patch.mock.calls[0]
}

const posted = async () => {
  await waitFor(() => expect(mocks.post).toHaveBeenCalled())
  return mocks.post.mock.calls[0][1]
}

describe('the city an activity is pinned to', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.post.mockReset()
    mocks.patch.mockReset()
    mocks.patch.mockResolvedValue({ item: { ...ITEM, zone_id: 'z1' } })
    mocks.get.mockResolvedValue(TRIP_BUNDLE)
    mocks.post.mockResolvedValue({
      item: { id: 'i1', trip_id: 'trip-1', zone_id: 'z1', day: '2026-10-09' },
    })
  })

  it('is inferred silently from the trip screen on an ordinary day', async () => {
    const user = await openAddForm('2026-10-06')
    expect(screen.queryByText('Which city is this in?')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(await posted()).toMatchObject({ day: '2026-10-06', zone_id: 'z1' })
  })

  it('is asked for on the trip screen when two cities share the day', async () => {
    const user = await openAddForm('2026-10-09')
    expect(screen.getByText('Which city is this in?')).toBeInTheDocument()
    // Unanswered, there is nothing to save: a default here is the guess this replaced.
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()

    // Tokyo, the city being left — the answer the old code could never give.
    await user.click(screen.getByRole('button', { name: 'Tokyo' }))
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(await posted()).toMatchObject({ day: '2026-10-09', zone_id: 'z1' })
  })

  it('takes the other city just as readily', async () => {
    const user = await openAddForm('2026-10-09')
    await user.click(screen.getByRole('button', { name: 'Kyoto' }))
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(await posted()).toMatchObject({ day: '2026-10-09', zone_id: 'z2' })
  })

  it('is never asked for on a city page — that page is the answer', async () => {
    // Even on the moving day: you are looking at Tokyo, so it goes in Tokyo.
    const user = await openAddForm('2026-10-09', { mode: 'zone', zoneId: 'z1' })
    expect(screen.queryByText('Which city is this in?')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(await posted()).toMatchObject({ day: '2026-10-09', zone_id: 'z1' })
  })

  it('is offered again when editing, starting on the city the activity has', async () => {
    // The row as the old code wrote it: a morning in Tokyo stamped with Kyoto.
    renderSchedule('2026-10-09', { mode: 'trip' }, [ITEM])
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Edit' }))

    // Kyoto is where it says it is, so that is what the form opens on — and a
    // form that already has an answer is saveable as it stands.
    expect(screen.getByRole('button', { name: 'Kyoto' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Tokyo' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const [path, patch] = await patched()
    expect(path).toBe('/trips/trip-1/itinerary/i1')
    expect(patch).toMatchObject({ zone_id: 'z1' })
  })

  it('is left alone when editing changed something else', async () => {
    renderSchedule('2026-10-09', { mode: 'trip' }, [ITEM])
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByLabelText('Activity'), ' and a pastry')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const [, patch] = await patched()
    expect(patch).toMatchObject({ title: 'Last coffee and a pastry' })
    expect(patch).not.toHaveProperty('zone_id')
  })
})
