// The journey editor's date fields: which one is which, and what a rejected
// save reads like.
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import JourneySteps from '../pages/JourneySteps'
import { saveErrorMessage } from '../lib/errors'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }))

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: mocks,
}))

const TRIP_BUNDLE = {
  trip: {
    id: 'trip-1',
    name: 'Lisbon',
    country: 'Portugal',
    display_title: 'Lisbon',
    start_date: '2027-03-01',
    end_date: '2027-03-08',
    description: null,
    people: [],
  },
  steps: [
    {
      id: 'step-1',
      position: 1,
      start_date: '2027-03-01',
      end_date: '2027-03-04',
      zone: {
        id: 'zone-1',
        name: 'Porto',
        name_ja: null,
        summary: null,
        image_url: null,
        saved_counts: {},
      },
    },
  ],
  trip_files_count: 0,
  flight: null,
}

function renderEditor() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/trips/trip-1/journey/edit']}>
        <Routes>
          <Route path="/trips/:tripId/journey/edit" element={<JourneySteps />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('the journey editor', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.post.mockReset()
    mocks.patch.mockReset()
    mocks.get.mockResolvedValue(TRIP_BUNDLE)
  })

  it('labels both date fields, so the two are told apart', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(await screen.findByRole('button', { name: '+ Add a destination' }))

    expect(screen.getByLabelText('Start date')).toHaveAttribute('type', 'date')
    expect(screen.getByLabelText('End date')).toHaveAttribute('type', 'date')
    // Visible text, not just an accessible name: an empty date input shows
    // nothing but the browser's own placeholder.
    expect(screen.getByText('Start date')).toBeInTheDocument()
    expect(screen.getByText('End date')).toBeInTheDocument()
  })

  it('shows a rejected save in words rather than in field names', async () => {
    const user = userEvent.setup()
    mocks.patch.mockRejectedValue(
      new ApiError(400, 'VALIDATION', 'Validation failed', [
        'end_date must be on or after start_date',
      ])
    )
    renderEditor()
    // Editing an existing stop, so the save needs nothing but the dates —
    // adding one would first want a destination picked from the autocomplete.
    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    await user.clear(screen.getByLabelText('End date'))
    await user.type(screen.getByLabelText('End date'), '2027-02-28')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(screen.getByText('end date must be on or after start date')).toBeInTheDocument()
    )
  })
})

describe('saveErrorMessage', () => {
  it('spaces out every field name a validation message mentions', () => {
    const error = new ApiError(400, 'VALIDATION', 'Validation failed', [
      "start_date must fall within the trip's dates (2027-03-01 – 2027-03-08)",
    ])
    expect(saveErrorMessage(error)).toBe(
      "start date must fall within the trip's dates (2027-03-01 – 2027-03-08)"
    )
  })

  it('leaves single-word field names and prose alone', () => {
    const error = new ApiError(400, 'VALIDATION', 'Validation failed', [
      "day must fall within the trip's dates (2027-03-01 – 2027-03-08)",
    ])
    expect(saveErrorMessage(error)).toBe(
      "day must fall within the trip's dates (2027-03-01 – 2027-03-08)"
    )
  })

  it('falls back for anything that is not a validation failure', () => {
    expect(saveErrorMessage(new ApiError(500, 'INTERNAL', 'Boom'))).toBe('Save failed — try again.')
  })
})
