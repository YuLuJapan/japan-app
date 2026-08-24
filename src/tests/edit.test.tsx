import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { withTableMissing } from '../../server/testing/db'
import { ConfirmDialog } from '../components/ConfirmDialog'
import PlaceDetail from '../pages/PlaceDetail'
import PlaceForm from '../pages/PlaceForm'
import { rows } from './data'
import { renderAt } from './helpers'

interface PlaceRow {
  id: string
  name: string
}

describe('ConfirmDialog (FR-017)', () => {
  it('renders nothing when closed and confirms only on explicit tap', async () => {
    const onConfirm = vi.fn()
    const { rerender } = render(
      <ConfirmDialog open={false} title="Delete?" onConfirm={onConfirm} onCancel={() => {}} />
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    rerender(<ConfirmDialog open title="Delete?" onConfirm={onConfirm} onCancel={() => {}} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})

describe('PlaceDetail delete flow (FR-017)', () => {
  it('asks for confirmation before firing the delete mutation', async () => {
    // place-hotel rather than place-ramen: the latter carries a tip and a
    // document, each with a Delete of its own, and this case is about the
    // place's.
    renderAt('/trips/trip-1/places/place-hotel', [
      { path: '/trips/:tripId/places/:placeId', element: <PlaceDetail /> },
      { path: '/trips/:tripId/zones/:zoneId/c/:category', element: <p>list</p> },
    ])

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    // Dialog first: the row is still there, which is a stronger claim than
    // "the client function was not called".
    expect(await rows<PlaceRow>('places', 'id', 'place-hotel')).toHaveLength(1)

    // the dialog's confirm button is labeled "Delete" too — click the one inside the dialog
    const dialog = screen.getByRole('dialog')
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent === 'Delete'
    )!
    await userEvent.click(confirm)
    await waitFor(async () =>
      expect(await rows<PlaceRow>('places', 'id', 'place-hotel')).toHaveLength(0)
    )
  })
})

describe('PlaceForm failure path (FR-019)', () => {
  it('keeps the entered text and offers retry when the save fails', async () => {
    renderAt('/trips/trip-1/zones/zone-tokyo/places/new', [
      { path: '/trips/:tripId/zones/:zoneId/places/new', element: <PlaceForm /> },
    ])

    const name = screen.getByLabelText('Name *')
    await userEvent.type(name, 'Hidden Gyoza Bar')

    // A save that really fails: the table is genuinely gone for the duration,
    // so the API errors the way it would against an unmigrated database rather
    // than because a stub was told to reject.
    await withTableMissing('places', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Add place' }))
      expect(await screen.findByText(/Save failed — your text is safe/)).toBeInTheDocument()
      expect(name).toHaveValue('Hidden Gyoza Bar') // input preserved
    })

    await userEvent.click(screen.getByRole('button', { name: 'Retry save' }))

    await waitFor(async () => {
      const saved = await rows<PlaceRow>('places', 'zone_id', 'zone-tokyo')
      expect(saved.map((p) => p.name)).toContain('Hidden Gyoza Bar')
    })
  })
})
