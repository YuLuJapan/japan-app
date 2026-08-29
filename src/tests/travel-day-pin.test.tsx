// What the trip screen stamps on an activity added to a day two cities share.
//
// `primaryStep` answers "the city you sleep in that night", which on a moving day is
// the one you arrive in — so every activity added from the trip screen was pinned to
// the arrival city, including the morning you spend leaving the other one. On a shared
// day the trip screen now pins nothing: an unpinned activity belongs to both cities.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Schedule } from '../components/Schedule'
import type { TripStep } from '../api/types'
import { renderAt } from './helpers'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }))

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

const addOn = async (today: string) => {
  renderAt('/trips/trip-1', [
    {
      path: '/trips/:tripId',
      element: (
        <Schedule
          mode="trip"
          steps={steps}
          items={[]}
          days={['2026-10-06', '2026-10-09']}
          today={today}
          tripId="trip-1"
        />
      ),
    },
  ])
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '+ Add activity' }))
  await user.type(screen.getByLabelText('Activity'), 'Breakfast')
  await user.click(screen.getByRole('button', { name: 'Add' }))
  await waitFor(() => expect(mocks.post).toHaveBeenCalled())
  return mocks.post.mock.calls[0][1]
}

describe('adding to a day from the trip screen', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.post.mockReset()
    mocks.get.mockResolvedValue(TRIP_BUNDLE)
    mocks.post.mockResolvedValue({
      item: { id: 'i1', trip_id: 'trip-1', zone_id: null, day: '2026-10-09' },
    })
  })

  it('pins an ordinary day to the city it is spent in', async () => {
    expect(await addOn('2026-10-06')).toMatchObject({ day: '2026-10-06', zone_id: 'z1' })
  })

  it('leaves a moving day unpinned, so it reads from both cities', async () => {
    expect(await addOn('2026-10-09')).toMatchObject({ day: '2026-10-09', zone_id: null })
  })
})
