// Renaming a document, and the flag that decides whether anyone is offered it.
//
// The flag is the interesting half: `files-rename` off has to leave the list
// exactly as it was — a dark feature is one nobody can find, not one that is
// merely inconvenient to reach.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FileList } from '../components/FileList'
import type { FileMeta } from '../api/types'
import { renderAt } from './helpers'

const flag = vi.hoisted(() => ({ on: false }))
vi.mock('../lib/flags', () => ({ useBooleanFlag: () => flag.on }))

const mocks = vi.hoisted(() => ({ patch: vi.fn(), delete: vi.fn() }))
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: { patch: mocks.patch, delete: mocks.delete },
}))

const file: FileMeta = {
  id: 'file-1',
  display_name: 'Flight booking',
  mime_type: 'application/pdf',
  size_bytes: 2048,
}

const show = (role: 'owner' | 'viewer' = 'owner') =>
  renderAt(
    '/trips/trip-1/files',
    [
      {
        path: '/trips/:tripId/files',
        element: <FileList files={[file]} deletable={{ kind: 'trip' }} />,
      },
    ],
    { tripRole: role }
  )

beforeEach(() => {
  flag.on = false
  mocks.patch.mockReset()
  mocks.patch.mockResolvedValue({ file: { ...file, display_name: 'Flights — Tokyo' } })
})

describe('with files-rename off', () => {
  it('offers no rename at all — the delete is untouched', () => {
    show()
    expect(screen.queryByRole('button', { name: /^Rename/ })).toBeNull()
    expect(screen.getByRole('button', { name: /^Delete/ })).toBeInTheDocument()
  })
})

describe('with files-rename on', () => {
  beforeEach(() => {
    flag.on = true
  })

  it('renames the file in place', async () => {
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: 'Rename Flight booking' }))

    const field = screen.getByRole('textbox', { name: 'Rename Flight booking' })
    expect(field).toHaveValue('Flight booking') // starts from the current name
    await user.clear(field)
    await user.type(field, 'Flights — Tokyo')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith('/trips/trip-1/files/file-1', {
        display_name: 'Flights — Tokyo',
      })
    )
  })

  it('sends nothing when the name comes back unchanged', async () => {
    // A request that could only no-op is not worth making.
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: 'Rename Flight booking' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mocks.patch).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Rename Flight booking' })).toBeInTheDocument()
  })

  it('sends nothing when the name is emptied', async () => {
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: 'Rename Flight booking' }))
    await user.clear(screen.getByRole('textbox', { name: 'Rename Flight booking' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mocks.patch).not.toHaveBeenCalled()
  })

  it('cancels back to the list, leaving the name alone', async () => {
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: 'Rename Flight booking' }))
    await user.type(screen.getByRole('textbox', { name: 'Rename Flight booking' }), ' 2')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mocks.patch).not.toHaveBeenCalled()
    expect(screen.getByText('Flight booking')).toBeInTheDocument()
  })

  it('is not offered to a viewer, flag or no flag', () => {
    // The server refuses them anyway; this is about not offering a button
    // that could only fail.
    show('viewer')
    expect(screen.queryByRole('button', { name: /^Rename/ })).toBeNull()
  })
})
