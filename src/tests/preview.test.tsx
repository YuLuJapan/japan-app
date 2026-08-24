// Documents open in an in-app preview instead of downloading (FR-008).
//
// The bytes come out of real Storage, so the FILE_MISSING case is a row whose
// blob genuinely is not there rather than a rejection a stub was handed.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import DocumentPreview from '../pages/DocumentPreview'
import TripFiles from '../pages/TripFiles'
import { renderAt } from './helpers'

const renderPreview = (fileId: string) =>
  renderAt(`/trips/trip-1/files/${fileId}`, [
    { path: '/trips/:tripId/files/:fileId', element: <DocumentPreview /> },
  ])

beforeEach(() => {
  // jsdom implements neither, and they are browser plumbing rather than
  // anything this app owns — the blob they wrap is real.
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

describe('DocumentPreview page', () => {
  it('renders a PDF inline with save/full-screen actions instead of downloading it', async () => {
    renderPreview('file-trip')

    // The src is the object URL for bytes the API really streamed back from
    // Storage — over the trip-scoped path, which is the only one that exists.
    expect(await screen.findByTitle('Flight booking')).toHaveAttribute('src', 'blob:preview')
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute(
      'download',
      'Flight booking.pdf'
    )
    expect(screen.getByRole('link', { name: 'Open full screen' })).toBeInTheDocument()
  })

  it('renders an image attached to a place, with a link back to it', async () => {
    renderPreview('file-place')

    expect(await screen.findByAltText('Menu photo')).toHaveAttribute('src', 'blob:preview')
    expect(screen.getByRole('link', { name: 'Ramen Bar' })).toHaveAttribute(
      'href',
      '/trips/trip-1/places/place-ramen'
    )
  })

  it('explains a missing blob rather than showing a blank screen (FR-013)', async () => {
    // file-gone is a row the fixture deliberately leaves without a blob.
    renderPreview('file-gone')

    expect(await screen.findByText(/missing from storage/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Download' })).not.toBeInTheDocument()
  })
})

describe('Documents list', () => {
  it('links each document to its preview screen', async () => {
    renderAt('/trips/trip-1/files', [{ path: '/trips/:tripId/files', element: <TripFiles /> }])

    expect(await screen.findByRole('link', { name: /Flight booking/ })).toHaveAttribute(
      'href',
      '/trips/trip-1/files/file-trip'
    )
  })
})
