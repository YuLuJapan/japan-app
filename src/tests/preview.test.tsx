// Documents open in an in-app preview instead of downloading (FR-008).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { ApiError } from '../api/client'
import DocumentPreview from '../pages/DocumentPreview'
import TripFiles from '../pages/TripFiles'
import { renderAt } from './helpers'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  blob: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: mocks,
}))

const doc = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'file-1',
  display_name: 'Flight ticket',
  mime_type: 'application/pdf',
  size_bytes: 2048,
  attached_to: { kind: 'trip', id: 'trip-1', name: 'Trip' },
  ...over,
})

const renderPreview = () =>
  renderAt('/files/file-1', [{ path: '/files/:fileId', element: <DocumentPreview /> }])

beforeEach(() => {
  vi.clearAllMocks()
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

describe('DocumentPreview page', () => {
  it('renders a PDF inline with save/full-screen actions instead of downloading it', async () => {
    mocks.get.mockResolvedValue({ files: [doc()] })
    mocks.blob.mockResolvedValue(new Blob(['%PDF-1.4'], { type: 'application/pdf' }))
    renderPreview()

    expect(await screen.findByTitle('Flight ticket')).toHaveAttribute('src', 'blob:preview')
    expect(mocks.blob).toHaveBeenCalledWith('/files/file-1/content')
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute(
      'download',
      'Flight ticket.pdf'
    )
    expect(screen.getByRole('link', { name: 'Open full screen' })).toBeInTheDocument()
  })

  it('renders an image attached to a place, with a link back to it', async () => {
    mocks.get.mockResolvedValue({
      files: [
        doc({
          display_name: 'Entrance ticket',
          mime_type: 'image/png',
          attached_to: { kind: 'place', id: 'place-1', name: 'teamLab' },
        }),
      ],
    })
    mocks.blob.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
    renderPreview()

    expect(await screen.findByAltText('Entrance ticket')).toHaveAttribute('src', 'blob:preview')
    expect(screen.getByRole('link', { name: 'teamLab' })).toHaveAttribute('href', '/places/place-1')
  })

  it('explains a missing blob rather than showing a blank screen (FR-013)', async () => {
    mocks.get.mockResolvedValue({ files: [doc()] })
    mocks.blob.mockRejectedValue(new ApiError(404, 'FILE_MISSING', 'gone'))
    renderPreview()

    expect(await screen.findByText(/missing from storage/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Download' })).not.toBeInTheDocument()
  })
})

describe('Documents list', () => {
  it('links each document to its preview screen', async () => {
    mocks.get.mockResolvedValue({ files: [doc()] })
    renderAt('/files', [{ path: '/files', element: <TripFiles /> }])

    expect(await screen.findByRole('link', { name: /Flight ticket/ })).toHaveAttribute(
      'href',
      '/files/file-1'
    )
  })
})
