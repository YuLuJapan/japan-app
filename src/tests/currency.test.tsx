// The trip's own currencies: chosen on the trip sheet, spent by the calculator.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CurrencyCalculator } from '../components/CurrencyCalculator'
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

const CATALOGUE = {
  currencies: [
    { code: 'USD', name: 'US Dollar' },
    { code: 'EUR', name: 'Euro' },
    { code: 'ILS', name: 'Israeli Shekel' },
    { code: 'JPY', name: 'Japanese Yen' },
    { code: 'THB', name: 'Thai Baht' },
  ],
  by_country: { thailand: 'THB', japan: 'JPY' },
}

function renderWithClient(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('CurrencyCalculator', () => {
  beforeEach(() => {
    mocks.get.mockReset()
  })

  it('asks for the trip’s own currencies and shows a card for each', async () => {
    mocks.get.mockResolvedValue({
      base: 'THB',
      date: '2026-08-01',
      rates: { EUR: 0.026, ILS: 0.1 },
      missing: [],
    })
    renderWithClient(<CurrencyCalculator local="THB" home={['EUR', 'ILS']} />)

    await waitFor(() => expect(mocks.get).toHaveBeenCalled())
    expect(mocks.get.mock.calls[0][0]).toBe('/rates?base=THB&symbols=EUR%2CILS')

    expect(screen.getByLabelText('Amount in THB')).toBeInTheDocument()
    expect(await screen.findByText('EUR')).toBeInTheDocument()
    expect(screen.getByText('ILS')).toBeInTheDocument()
    // 100 THB (the quick amount for a currency of this size) in euros
    expect(await screen.findByText('€2.60')).toBeInTheDocument()
  })

  it('says so when the provider has no rate for one of them', async () => {
    mocks.get.mockResolvedValue({
      base: 'JPY',
      date: '2026-08-01',
      rates: { USD: 0.0067 },
      missing: ['ILS'],
    })
    renderWithClient(<CurrencyCalculator local="JPY" home={['USD', 'ILS']} />)

    expect(await screen.findByText('No rate for ILS today.')).toBeInTheDocument()
  })
})

const TRIP: Trip = {
  id: 'trip-1',
  name: 'Lisbon',
  country: 'Portugal',
  country_code: 'PT',
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

describe('TripSheet currency pickers', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.post.mockReset()
    mocks.get.mockImplementation((path: string) => {
      if (path === '/currencies') return Promise.resolve(CATALOGUE)
      // The country field is a list now (spec 008), so the sheet asks for one.
      if (path === '/countries')
        return Promise.resolve({
          countries: [
            { code: 'TH', name: 'Thailand' },
            { code: 'PT', name: 'Portugal' },
            { code: 'JP', name: 'Japan' },
          ],
        })
      return Promise.resolve({})
    })
    mocks.post.mockResolvedValue({ trip: TRIP })
  })

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

    await waitFor(() => expect(mocks.post).toHaveBeenCalled())
    expect(mocks.post.mock.calls[0][1]).toMatchObject({
      local_currency: 'THB',
      home_currencies: ['USD', 'ILS', 'EUR'],
    })
  })

  it('opens an existing trip on its own currencies and leaves them alone', async () => {
    const user = userEvent.setup()
    mocks.patch.mockResolvedValue({ trip: TRIP })
    renderWithClient(<TripSheet mode="edit" trip={TRIP} onClose={() => {}} />)

    const currency = (await screen.findByLabelText('Money spent there')) as HTMLSelectElement
    expect(currency.value).toBe('EUR')
    // Portugal is the trip's country, but the stored choice is not re-guessed.
    expect(await screen.findByText('US Dollar')).toBeInTheDocument()

    // the only conversion currency cannot be removed — one is the minimum
    expect(screen.queryByLabelText('Remove USD')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Add a currency to convert to'), 'ILS')
    await user.click(screen.getByLabelText('Remove USD'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(mocks.patch).toHaveBeenCalled())
    expect(mocks.patch.mock.calls[0][1]).toMatchObject({
      local_currency: 'EUR',
      home_currencies: ['ILS'],
    })
  })
})
