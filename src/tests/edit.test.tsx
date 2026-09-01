import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog } from '../components/ConfirmDialog'
import ActivityDetail from '../pages/ActivityDetail'
import ActivityForm from '../pages/ActivityForm'
import { renderAt } from './helpers'

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

describe('ActivityDetail delete flow (FR-017)', () => {
  it('asks for confirmation before firing the delete mutation', async () => {
    mocks.get.mockResolvedValue({
      activity: {
        id: 'p1',
        zone_id: 'z1',
        category: 'food',
        name: 'Ramen Bar',
        name_ja: null,
        description: null,
        address: null,
        links: [],
      },
      tips: [],
      files: [],
    })
    mocks.delete.mockResolvedValue(undefined)
    renderAt('/trips/trip-1/activities/p1', [
      { path: '/trips/:tripId/activities/:activityId', element: <ActivityDetail /> },
      { path: '/trips/:tripId/zones/:zoneId/c/:category', element: <p>list</p> },
    ])

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(mocks.delete).not.toHaveBeenCalled() // dialog first, no mutation yet

    // the dialog's confirm button is labeled "Delete" too — click the one inside the dialog
    const dialog = screen.getByRole('dialog')
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent === 'Delete'
    )!
    await userEvent.click(confirm)
    await waitFor(() => expect(mocks.delete).toHaveBeenCalledWith('/trips/trip-1/activities/p1'))
  })
})

describe('ActivityForm failure path (FR-019)', () => {
  it('keeps the entered text and offers retry when the save fails', async () => {
    mocks.post.mockRejectedValue(new Error('offline'))
    renderAt('/trips/trip-1/zones/z1/places/new', [
      { path: '/trips/:tripId/zones/:zoneId/places/new', element: <ActivityForm /> },
    ])

    const name = screen.getByLabelText('Name *')
    await userEvent.type(name, 'Hidden Gyoza Bar')
    await userEvent.click(screen.getByRole('button', { name: 'Add place' }))

    expect(await screen.findByText(/Save failed — your text is safe/)).toBeInTheDocument()
    expect(name).toHaveValue('Hidden Gyoza Bar') // input preserved
    const retry = screen.getByRole('button', { name: 'Retry save' })

    mocks.post.mockResolvedValue({ activity: { id: 'p-new' } })
    await userEvent.click(retry)
    await waitFor(() =>
      expect(mocks.post).toHaveBeenLastCalledWith(
        '/trips/trip-1/activities',
        expect.objectContaining({ name: 'Hidden Gyoza Bar', zone_id: 'z1' })
      )
    )
  })
})
