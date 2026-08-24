// Essentials carries a lot of Japan-specific advice. Which of it a trip sees is
// decided by the trip's own country, not by the fact that the app was written
// for a Japan trip.
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TripEssentials from '../pages/TripEssentials'
import { isJapanTrip } from '../lib/destination'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }))

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: mocks,
}))

const bundle = (country: string | null) => ({
  trip: {
    id: 'trip-1',
    name: null,
    country,
    display_title: country ? `Trip to ${country}` : 'Our trip',
    start_date: '2027-03-01',
    end_date: '2027-03-08',
    description: null,
    people: [],
    local_currency: 'JPY',
    home_currencies: ['USD'],
    start_time: null,
    start_tz: null,
  },
  steps: [],
  trip_files_count: 0,
  flight: null,
})

function renderEssentials(country: string | null) {
  mocks.get.mockImplementation((path: string) => {
    if (path === '/trips/trip-1') return Promise.resolve(bundle(country))
    // The currency calculator's rates — irrelevant here, but it asks.
    return Promise.resolve({ base: 'JPY', date: '2027-03-01', rates: { USD: 0.0067 }, missing: [] })
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/trips/trip-1/essentials']}>
        <Routes>
          <Route path="/trips/:tripId/essentials" element={<TripEssentials />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('isJapanTrip', () => {
  it('matches the spellings a person actually types', () => {
    for (const country of ['Japan', ' japan ', 'JAPAN', 'jp', 'Nippon', '日本', 'Japan & Korea'])
      expect(isJapanTrip(country)).toBe(true)
  })

  it('is false for anywhere else, and for a trip with no country yet', () => {
    for (const country of ['Portugal', 'Jordan', 'Japanophile Tours', '', null, undefined])
      expect(isJapanTrip(country)).toBe(false)
  })
})

describe('TripEssentials', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    localStorage.clear()
  })

  it('gives a Japan trip the Japan half: phrases, emergency numbers, Visit Japan Web', async () => {
    renderEssentials('Japan')

    expect(await screen.findByText('Handy phrases')).toBeInTheDocument()
    expect(screen.getByText('Emergency')).toBeInTheDocument()
    expect(screen.getByText('Arigatou gozaimasu')).toBeInTheDocument()
    expect(screen.getByText('Japan Visitor Hotline (24h, EN)')).toBeInTheDocument()
    expect(screen.getByText('Visit Japan Web (do before you fly)')).toBeInTheDocument()
    expect(screen.getByText('Things not to forget')).toBeInTheDocument()
    expect(screen.getByText('Visit Japan Web QR (both of us)')).toBeInTheDocument()
    expect(screen.getByText('Power adapter (Type A, 100V)')).toBeInTheDocument()
  })

  it('reminds a Japan trip about Visit Japan Web inside “Things not to forget”', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    renderEssentials('Japan')

    await user.click(await screen.findByRole('button', { name: /Things not to forget/ }))
    expect(screen.getByText(/Visit Japan Web: register both of us/)).toBeInTheDocument()
  })

  it('drops every Japan-only card, phrase and number on a trip somewhere else', async () => {
    renderEssentials('Portugal')

    // The generic cards still arrive, so this is "filtered", not "still loading".
    expect(await screen.findByText('Things not to forget')).toBeInTheDocument()
    expect(screen.getByText('Connectivity')).toBeInTheDocument()

    expect(screen.queryByText('Handy phrases')).not.toBeInTheDocument()
    expect(screen.queryByText('Emergency')).not.toBeInTheDocument()
    expect(screen.queryByText('Visit Japan Web (do before you fly)')).not.toBeInTheDocument()
    expect(screen.queryByText('Trains & tickets')).not.toBeInTheDocument()
    expect(screen.queryByText('Money')).not.toBeInTheDocument()
  })

  it('packs only what travels when the trip is not to Japan', async () => {
    renderEssentials('Portugal')

    expect(await screen.findByText('Passports + travel insurance')).toBeInTheDocument()
    expect(screen.queryByText('Visit Japan Web QR (both of us)')).not.toBeInTheDocument()
    expect(screen.queryByText('IC card set up in the phone wallet')).not.toBeInTheDocument()
    expect(screen.queryByText('Cash in yen for day one')).not.toBeInTheDocument()
    expect(screen.getByText('Power adapter for the local sockets')).toBeInTheDocument()
  })

  it('has no “Open items — still to sort” card any more', async () => {
    renderEssentials('Japan')

    await waitFor(() => expect(screen.getByText('Things not to forget')).toBeInTheDocument())
    expect(screen.queryByText(/Open items/)).not.toBeInTheDocument()
  })
})
