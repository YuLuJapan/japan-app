// The trip's own currencies: chosen on the trip sheet, spent by the calculator.
//
// The rates come from the API, which quotes them from the local stand-in for
// the provider (server/testing/outside-world.ts) — so €2.60 below is the
// figure the server really computed, not one a stub was handed.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { CurrencyCalculator } from '../components/CurrencyCalculator'
import { TripSheet } from '../components/TripSheet'
import type { Trip } from '../api/types'
import { patchTrip, remove, rows } from './data'

interface TripRow {
  id: string
  local_currency: string
  home_currencies: string[]
}

function renderWithClient(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('CurrencyCalculator', () => {
  it('asks for the trip’s own currencies and shows a card for each', async () => {
    renderWithClient(<CurrencyCalculator local="THB" home={['EUR', 'ILS']} />)

    expect(screen.getByLabelText('Amount in THB')).toBeInTheDocument()
    expect(await screen.findByText('EUR')).toBeInTheDocument()
    expect(screen.getByText('ILS')).toBeInTheDocument()
    // 100 THB (the quick amount for a currency of this size) at 0.026 EUR each
    expect(await screen.findByText('€2.60')).toBeInTheDocument()
  })

  it('says so when the provider has no rate for one of them', async () => {
    // The provider quotes JPY in USD, ILS and EUR — and not in THB.
    renderWithClient(<CurrencyCalculator local="JPY" home={['USD', 'THB']} />)

    expect(await screen.findByText('No rate for THB today.')).toBeInTheDocument()
  })
})

describe('TripSheet currency pickers', () => {
  it('guesses the currency from the country, and sends both sides on create', async () => {
    const user = userEvent.setup()
    renderWithClient(<TripSheet mode="add" onClose={() => {}} />)

    const currency = (await screen.findByLabelText('Money spent there')) as HTMLSelectElement
    expect(currency.value).toBe('JPY') // the default, until a country says otherwise

    await user.type(screen.getByLabelText('Country'), 'Thailand')
    await waitFor(() => expect(currency.value).toBe('THB'))

    // a third conversion currency, on top of the default USD + ILS
    await user.selectOptions(screen.getByLabelText('Add a currency to convert to'), 'EUR')
    await user.type(screen.getByLabelText('Name it (optional)'), 'Bangkok')
    await user.selectOptions(screen.getByLabelText('Start day'), '01')
    await user.selectOptions(screen.getByLabelText('Start month'), 'Mar')
    await user.selectOptions(screen.getByLabelText('Start year'), '2027')
    await user.selectOptions(screen.getByLabelText('End day'), '08')
    await user.selectOptions(screen.getByLabelText('End month'), 'Mar')
    await user.selectOptions(screen.getByLabelText('End year'), '2027')
    await user.click(screen.getByRole('button', { name: 'Create trip' }))

    // Both sides landed on the row the server created.
    await waitFor(
      async () => {
        const created = (await rows<TripRow>('trips', 'name', 'Bangkok'))[0]
        expect(created).toMatchObject({
          local_currency: 'THB',
          home_currencies: ['USD', 'ILS', 'EUR'],
        })
      },
      { timeout: 5000 }
    )
  })

  it('opens an existing trip on its own currencies and leaves them alone', async () => {
    const user = userEvent.setup()
    // Portugal on euros — a trip whose country would guess something else.
    //
    // Its stops and activities go first. The dates below move the trip to
    // 2027, and the API refuses a move that strands them unless it is told
    // what to do with them — a rule the stubbed client used to hide, so this
    // case was asserting a request the server would have rejected.
    await remove('journey_steps', 'trip_id', 'trip-1')
    await remove('itinerary_items', 'trip_id', 'trip-1')
    await patchTrip('trip-1', {
      name: 'Lisbon',
      country: 'Portugal',
      local_currency: 'EUR',
      home_currencies: ['USD'],
      start_date: '2027-03-01',
      end_date: '2027-03-08',
    })
    // The trip as the API hands it to the sheet — a raw row would carry
    // created_at/updated_at, which the form would echo back into the patch.
    const trip: Trip = {
      id: 'trip-1',
      name: 'Lisbon',
      country: 'Portugal',
      display_title: 'Lisbon',
      start_date: '2027-03-01',
      end_date: '2027-03-08',
      description: null,
      people: [],
      local_currency: 'EUR',
      home_currencies: ['USD'],
      start_time: null,
      start_tz: null,
    }
    renderWithClient(<TripSheet mode="edit" trip={trip} onClose={() => {}} />)

    const currency = (await screen.findByLabelText('Money spent there')) as HTMLSelectElement
    expect(currency.value).toBe('EUR')
    // Portugal is the trip's country, but the stored choice is not re-guessed.
    expect(await screen.findByText('US Dollar')).toBeInTheDocument()

    // the only conversion currency cannot be removed — one is the minimum
    expect(screen.queryByLabelText('Remove USD')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Add a currency to convert to'), 'ILS')
    await user.click(screen.getByLabelText('Remove USD'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    // A longer window than the default second: each poll is a round trip to
    // the database, and the save it is waiting on is one too.
    await waitFor(
      async () => {
        const saved = (await rows<TripRow>('trips', 'id', 'trip-1'))[0]
        expect(saved).toMatchObject({ local_currency: 'EUR', home_currencies: ['ILS'] })
      },
      { timeout: 5000 }
    )
  })
})
