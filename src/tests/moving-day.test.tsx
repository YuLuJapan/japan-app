// A moving day (Tokyo → Hakone on the 25th) belongs to both cities: you're still
// out in the first one that morning. It must show up — flagged — on both pages.
//
// The two stops share the 25th in the database, and the API works out that
// they do; this file only says what the page should make of it.
import { beforeEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Zone from '../pages/Zone'
import { insert, patchTrip, remove } from './data'
import { renderAt } from './helpers'

beforeEach(async () => {
  await remove('journey_steps', 'trip_id', 'trip-1')
  await remove('itinerary_items', 'trip_id', 'trip-1')
  await patchTrip('trip-1', { start_date: '2026-09-23', end_date: '2026-09-27' })
  await insert('zones', [{ id: 'zone-hakone', trip_id: 'trip-1', name: 'Hakone' }])
  // The 25th is the last day of one stop and the first of the next.
  await insert('journey_steps', [
    {
      id: 's1',
      trip_id: 'trip-1',
      zone_id: 'zone-tokyo',
      position: 1,
      start_date: '2026-09-23',
      end_date: '2026-09-25',
    },
    {
      id: 's2',
      trip_id: 'trip-1',
      zone_id: 'zone-hakone',
      position: 2,
      start_date: '2026-09-25',
      end_date: '2026-09-27',
    },
  ])
  await insert('itinerary_items', [
    {
      id: 'i1',
      trip_id: 'trip-1',
      zone_id: 'zone-tokyo',
      day: '2026-09-25',
      start_time: '09:00',
      title: 'teamLab before the train',
      position: 0,
    },
  ])
})

const renderZone = (zoneId: string) =>
  renderAt(`/trips/trip-1/zones/${zoneId}`, [
    { path: '/trips/:tripId/zones/:zoneId', element: <Zone /> },
  ])

describe('moving days on a city page', () => {
  it('shows the checkout day on the city being left, flagged with where it goes', async () => {
    const user = userEvent.setup()
    renderZone('zone-tokyo')

    // Sep 25 is Tokyo's last morning — it used to be missing from this strip entirely.
    const chip = await screen.findByLabelText('2026-09-25 (moving day)')
    await user.click(chip)

    expect(screen.getByTestId('moving-day-chip')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '→ Hakone' })).toHaveAttribute(
      'href',
      '/trips/trip-1/zones/zone-hakone'
    )
    // things still planned in Tokyo that morning are listed
    expect(screen.getByText('teamLab before the train')).toBeInTheDocument()
  })

  it('shows the same day on the arrival city, pointing back where it came from', async () => {
    renderZone('zone-hakone')

    expect(await screen.findByLabelText('2026-09-25 (moving day)')).toBeInTheDocument()
    expect(screen.getByTestId('moving-day-chip')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Tokyo →' })).toHaveAttribute(
      'href',
      '/trips/trip-1/zones/zone-tokyo'
    )
    // the Tokyo-pinned morning activity stays out of Hakone's plan
    expect(screen.queryByText('teamLab before the train')).not.toBeInTheDocument()
  })

  it('leaves a day spent wholly in one city unflagged', async () => {
    const user = userEvent.setup()
    renderZone('zone-tokyo')

    await user.click(await screen.findByLabelText('2026-09-24'))
    expect(screen.queryByTestId('moving-day-chip')).not.toBeInTheDocument()
  })
})
