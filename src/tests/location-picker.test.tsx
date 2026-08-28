// The location picker, on its own.
//
// It was the journey editor's destination field until this feature needed the
// same interaction on the place form, so what is asserted here is the
// behaviour that was already there and must survive being moved: it waits
// before searching, it lists what came back, **it requires an explicit pick**,
// and it says so when nothing matched. The last one is the rule the feature
// leans on — nothing is stored that the traveller has not accepted (FR-003).
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LocationPicker } from '../components/LocationPicker'
import type { GeocodeResult } from '../api/types'

const mocks = vi.hoisted(() => ({ geocode: vi.fn() }))
vi.mock('../api/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/hooks')>()),
  geocode: mocks.geocode,
}))

const SHIBUYA: GeocodeResult = {
  name: 'Shibuya Crossing',
  address: 'Shibuya, Tokyo',
  lat: 35.6595,
  lng: 139.7005,
}

function picker(props: Partial<Parameters<typeof LocationPicker>[0]> = {}) {
  const onPick = vi.fn()
  render(
    <LocationPicker label="Destination" placeholder="Search a city…" onPick={onPick} {...props} />
  )
  return { onPick }
}

beforeEach(() => {
  mocks.geocode.mockReset()
  mocks.geocode.mockResolvedValue({ results: [SHIBUYA] })
})

describe('the location picker', () => {
  it('waits before searching, rather than on every keystroke', async () => {
    const user = userEvent.setup()
    picker()
    await user.type(screen.getByLabelText('Destination'), 'Shibuya')
    // Seven characters typed; the debounce has not elapsed, so nothing has
    // been asked of Nominatim yet — its policy is one request per second.
    expect(mocks.geocode).not.toHaveBeenCalled()
    await screen.findByRole('button', { name: /Shibuya Crossing/ })
    expect(mocks.geocode).toHaveBeenCalledTimes(1)
  })

  it('lists the candidates that came back', async () => {
    const user = userEvent.setup()
    picker()
    await user.type(screen.getByLabelText('Destination'), 'Shibuya')
    const option = await screen.findByRole('button', { name: /Shibuya Crossing/ })
    expect(option).toHaveTextContent('Shibuya, Tokyo')
  })

  it('emits nothing until a candidate is explicitly picked', async () => {
    const user = userEvent.setup()
    const { onPick } = picker()
    await user.type(screen.getByLabelText('Destination'), 'Shibuya')
    const option = await screen.findByRole('button', { name: /Shibuya Crossing/ })
    expect(onPick).not.toHaveBeenCalled()

    await user.click(option)
    expect(onPick).toHaveBeenCalledWith(SHIBUYA)
  })

  it('says so when nothing matched, rather than leaving an empty box', async () => {
    mocks.geocode.mockResolvedValue({ results: [] })
    const user = userEvent.setup()
    picker()
    await user.type(screen.getByLabelText('Destination'), 'Nowhere at all')
    expect(await screen.findByText(/No matches/)).toBeInTheDocument()
  })

  it('emits nothing, and searches for nothing, while the field is untouched', async () => {
    picker({ initialQuery: 'Porto' })
    // An edit that never touches the destination must keep the zone it has —
    // the journey editor's rule, and the reason this is not an effect on mount.
    await waitFor(() => expect(mocks.geocode).not.toHaveBeenCalled())
  })

  it('passes the bias coordinates through, so a search leans on the right city', async () => {
    const user = userEvent.setup()
    picker({ near: { lat: 35.68, lng: 139.76 } })
    await user.type(screen.getByLabelText('Destination'), 'Ichiran')
    await screen.findByRole('button', { name: /Shibuya Crossing/ })
    expect(mocks.geocode).toHaveBeenCalledWith('Ichiran', { lat: 35.68, lng: 139.76 })
  })

  it('clears the selection when the text changes again', async () => {
    const user = userEvent.setup()
    const { onPick } = picker()
    const field = screen.getByLabelText('Destination')
    await user.type(field, 'Shibuya')
    await user.click(await screen.findByRole('button', { name: /Shibuya Crossing/ }))
    onPick.mockClear()

    await user.type(field, ' station')
    // A picked candidate no longer describes what is in the box, so it is
    // withdrawn — the alternative is saving a location for a different place.
    expect(onPick).toHaveBeenCalledWith(null)
  })
})
